import "server-only";
import {
  chapterExtractionMessages,
  chapterExtractionSchema,
  chapterExtractionSettings,
  type OfferedChunk,
} from "@/features/knowledge-map/ai/chapter-extraction";
import { dailyLimitReason } from "@/features/knowledge-map/domain/build-failure";
import {
  checkExtraction,
  type UnitExtraction,
} from "@/features/knowledge-map/domain/chapter-extraction";
import {
  buildCall,
  loadCourseLanguage,
  loadCourseUnits,
  loadStoredUnits,
  runCalls,
  storeExtraction,
  touchBuild,
  unitKey,
  UNITS_PER_STEP,
  type CourseUnit,
  type StepOutcome,
} from "@/features/knowledge-map/workflows/build-steps";
import { RATE_LIMITED_STEP_RETRIES } from "@/features/usage/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AdminSupabase } from "@/lib/supabase/types";

/**
 * The extraction steps of a build: one call per teaching unit (task `map`)
 * whose content has no stored extraction, each stored as it finishes in
 * `chapter_extractions`, so a stopped build resumes without paying again.
 */

/**
 * Extracts up to UNITS_PER_STEP teaching units without a current
 * extraction, in Course order, at most AI_CONCURRENCY calls at a time. A
 * reached Daily limit stops the build; what is stored stays.
 */
export async function extractChapters(courseId: string): Promise<StepOutcome> {
  "use step";
  const supabase = createAdminClient();
  const owner = await touchBuild(supabase, courseId);
  if (!owner) return { ok: true, left: null };

  const [units, stored] = await Promise.all([
    loadCourseUnits(supabase, courseId, "content"),
    loadStoredUnits(supabase, courseId),
  ]);
  const hashOf = new Map(stored.map((row) => [row.key, row.contentHash]));
  const todo = units.filter(
    (unit) => hashOf.get(unitKey(unit)) !== unit.contentHash,
  );
  if (todo.length === 0) return { ok: true, left: 0 };

  const language = await loadCourseLanguage(supabase, courseId);
  let done = 0;
  let limitReached = false;
  await runCalls(todo.slice(0, UNITS_PER_STEP), async (unit) => {
    const extraction = await extractUnit(supabase, owner, unit, language);
    if (extraction === "limit") {
      limitReached = true;
      return "stop";
    }
    await storeExtraction(supabase, { owner, courseId, unit }, extraction);
    done += 1;
  });
  if (limitReached) return { ok: false, reason: dailyLimitReason };
  return { ok: true, left: todo.length - done };
}

extractChapters.maxRetries = RATE_LIMITED_STEP_RETRIES;

/** One unit's extraction call, checked; "limit" when the Daily limit is reached. */
async function extractUnit(
  supabase: AdminSupabase,
  owner: string,
  unit: CourseUnit,
  language: string,
): Promise<UnitExtraction | "limit"> {
  const offered = unit.chunks.map((chunk, index): OfferedChunk => ({
    id: `c${index + 1}`,
    markdown: chunk.markdown,
  })) as [OfferedChunk, ...OfferedChunk[]];
  const offeredUnit = {
    material: unit.materialName,
    outline: unit.outline,
    language,
    chunks: offered,
  };
  const answer = await buildCall(
    supabase,
    { studentId: owner, task: "map", traceName: "extract-chapter" },
    {
      ...chapterExtractionSettings(offeredUnit),
      messages: chapterExtractionMessages(offeredUnit),
    },
    chapterExtractionSchema(),
    (extraction) => extraction.kcs.length === 0,
  );
  if (answer === "limit") return "limit";
  return checkExtraction(
    answer,
    new Map(unit.chunks.map((chunk, index) => [offered[index]!.id, chunk.id])),
  );
}
