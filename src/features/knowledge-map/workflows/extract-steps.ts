import "server-only";
import {
  partExtractionMessages,
  partExtractionSchema,
  partExtractionSettings,
  type OfferedChunk,
} from "@/features/knowledge-map/ai/part-extraction";
import { dailyLimitReason } from "@/features/knowledge-map/domain/build-failure";
import {
  checkExtraction,
  kcBudget,
  type PartExtraction,
} from "@/features/knowledge-map/domain/part-extraction";
import {
  loadCourseLanguage,
  loadCourseParts,
  PARTS_PER_STEP,
  runCalls,
  touchBuild,
  type CoursePart,
  type StepOutcome,
} from "@/features/knowledge-map/workflows/build-steps";
import { meteredGenerate } from "@/features/usage/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";
import type { AdminSupabase } from "@/lib/supabase/types";

/**
 * The extraction steps of a build: one call per teaching Part (task `map`)
 * whose content has no stored extraction, each stored as it finishes in
 * `part_extractions`, so a stopped build resumes without paying again.
 */

/**
 * Extracts up to PARTS_PER_STEP teaching Parts without a current
 * extraction, in Course order, at most AI_CONCURRENCY calls at a time. A
 * reached Daily limit stops the build; what is stored stays.
 */
export async function extractParts(courseId: string): Promise<StepOutcome> {
  "use step";
  const supabase = createAdminClient();
  const owner = await touchBuild(supabase, courseId);
  if (!owner) return { ok: true, left: null };

  const [parts, stored] = await Promise.all([
    loadCourseParts(supabase, courseId),
    supabase
      .from("part_extractions")
      .select("part_id, content_hash")
      .eq("course_id", courseId),
  ]);
  if (stored.error) failed("Loading the Part extractions", stored.error);
  const hashOf = new Map(
    stored.data.map((row) => [row.part_id, row.content_hash]),
  );
  const todo = parts.filter(
    (part) =>
      part.kind === "teaching" && hashOf.get(part.id) !== part.contentHash,
  );
  if (todo.length === 0) return { ok: true, left: 0 };

  const batch = todo.slice(0, PARTS_PER_STEP);
  const [language, chunks] = await Promise.all([
    loadCourseLanguage(supabase, courseId),
    loadPartChunks(supabase, batch),
  ]);
  let done = 0;
  let limitReached = false;
  await runCalls(batch, async (part) => {
    const extraction = await extractPart(supabase, owner, {
      part,
      language,
      chunks: chunks.filter((chunk) => chunk.part_id === part.id),
    });
    if (extraction === "limit") {
      limitReached = true;
      return "stop";
    }
    const { error } = await supabase.from("part_extractions").upsert(
      {
        part_id: part.id,
        owner,
        course_id: courseId,
        content_hash: part.contentHash,
        output: extraction,
        kc_ids: null,
        assumes_matched: false,
      },
      { onConflict: "part_id" },
    );
    if (error) failed("Storing a Part extraction", error);
    done += 1;
  });
  if (limitReached) return { ok: false, reason: dailyLimitReason };
  return { ok: true, left: todo.length - done };
}

type PartChunk = { id: string; part_id: string | null; markdown: string };

async function loadPartChunks(
  supabase: AdminSupabase,
  parts: readonly CoursePart[],
): Promise<PartChunk[]> {
  const { data, error } = await supabase
    .from("chunks")
    .select("id, part_id, markdown")
    .in(
      "part_id",
      parts.map((part) => part.id),
    )
    .order("position");
  if (error) failed("Loading the Parts' chunks", error);
  return data;
}

/**
 * One Part's extraction call, checked; "limit" when the Daily limit is
 * reached. A Part without chunks makes no call.
 */
async function extractPart(
  supabase: AdminSupabase,
  owner: string,
  {
    part,
    language,
    chunks,
  }: { part: CoursePart; language: string; chunks: PartChunk[] },
): Promise<(PartExtraction & { kcBudget: number }) | "limit"> {
  const budget = kcBudget(chunks.map((chunk) => chunk.markdown));
  if (chunks.length === 0) {
    return { kcs: [], prerequisites: [], kcBudget: budget };
  }
  const offered = chunks.map((chunk, index): OfferedChunk => ({
    id: `c${index + 1}`,
    markdown: chunk.markdown,
  })) as [OfferedChunk, ...OfferedChunk[]];
  const offeredPart = {
    title: part.title,
    chapterTitle: part.chapterTitle,
    language,
    kcBudget: budget,
    chunks: offered,
  };
  const result = await meteredGenerate(
    supabase,
    { studentId: owner, task: "map", traceName: "extract-part" },
    {
      ...partExtractionSettings(),
      messages: partExtractionMessages(offeredPart),
    },
  );
  if (!result) return "limit";
  const answer = partExtractionSchema.parse(result.output);
  return {
    ...checkExtraction(
      answer,
      new Map(chunks.map((chunk, index) => [offered[index]!.id, chunk.id])),
    ),
    kcBudget: budget,
  };
}
