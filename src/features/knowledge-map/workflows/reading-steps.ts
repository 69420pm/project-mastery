import "server-only";
import {
  loadChunkTexts,
  loadCourseChunkSpans,
  type ChunkSpan,
} from "@/features/ingestion/server";
import {
  annotationsSchema,
  modeCall,
  modeSchema,
  studyTextSchema,
  writingCall,
} from "@/features/knowledge-map/ai/reading-calls";
import {
  checkAnnotations,
  checkStudyText,
} from "@/features/knowledge-map/domain/reading-checks";
import type {
  ReadingCallInput,
  ReadingChunk,
} from "@/features/knowledge-map/domain/reading-input";
import type {
  ReadingMode,
  ReadingSection,
  SectionToStore,
} from "@/features/knowledge-map/domain/topic-reading";
import type { Topic } from "@/features/knowledge-map/domain/topics";
import { loadStoredMap } from "@/features/knowledge-map/server/stored-map";
import { loadStoredReadingSections } from "@/features/knowledge-map/server/stored-reading-sections";
import { loadStoredTopics } from "@/features/knowledge-map/server/stored-topics";
import {
  limitReached,
  mapCall,
  type StepOutcome,
} from "@/features/knowledge-map/workflows/build-steps";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";

/**
 * The steps of the Reading stage of a Knowledge map build (#178), which runs
 * on the stored Topics after `storeTopics`, on the admin client like the
 * other steps (`build-steps.ts`).
 */

/** What the Reading stage reads once, after the Topics are stored. */
export type ReadingInput = {
  studentId: string;
  topics: Array<Topic & { id: string }>;
  /** The stored KCs with the chunks they cite. */
  kcs: Array<{
    id: string;
    name: string;
    type: string;
    description: string;
    sources: string[];
  }>;
  /** The Course's parsed chunks in reading order. */
  spans: ChunkSpan[];
  stored: Array<ReadingSection & { topicId: string }>;
};

/**
 * The owner, stored Topics, KCs, chunk places and stored sections of the
 * Course whose build runs. Null when no build runs any more.
 */
export async function loadReadingInput(
  courseId: string,
): Promise<ReadingInput | null> {
  "use step";
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("knowledge_map_builds")
    .select("owner")
    .eq("course_id", courseId)
    .eq("status", "building")
    .maybeSingle();
  if (error) failed("Loading the build", error);
  if (!data) return null;
  const [topics, map, spans, sections] = await Promise.all([
    loadStoredTopics(supabase, courseId),
    loadStoredMap(supabase, courseId),
    loadCourseChunkSpans(supabase, courseId),
    loadStoredReadingSections(supabase, courseId),
  ]);
  return {
    studentId: data.owner,
    topics,
    kcs: map.kcs.map(({ id, name, type, description, sources }) => ({
      id,
      name,
      type,
      description,
      sources,
    })),
    spans,
    stored: [...sections.entries()].flatMap(([topicId, rows]) =>
      rows.map((row) => ({ ...row, topicId })),
    ),
  };
}

/** The texts of these chunks by id, for the `reading` calls. */
export async function loadReadingChunks(
  chunkIds: string[],
): Promise<Record<string, ReadingChunk>> {
  "use step";
  return loadChunkTexts(createAdminClient(), chunkIds);
}

/** A section's mode and reason, as the mode call judged it. */
export type Judgement = { mode: ReadingMode; reason: string };

/** The mode call of a new section (task `reading`). */
export async function chooseReadingMode(
  studentId: string,
  input: ReadingCallInput,
): Promise<StepOutcome<Judgement>> {
  "use step";
  const output = await mapCall(
    studentId,
    "map-reading",
    modeCall(input),
    "reading",
  );
  if (output === null) return limitReached;
  return { ok: true, value: modeSchema.parse(output) };
}

/**
 * The writing call of a section judged `annotated` or `study_text` (task
 * `reading`): its notes or study text, which code checks against the
 * section's pages. A failed check throws, so the step retries.
 */
export async function writeReading(
  studentId: string,
  input: ReadingCallInput,
  judged: Judgement & { mode: Exclude<ReadingMode, "original"> },
): Promise<StepOutcome<Pick<ReadingSection, "annotations" | "studyText">>> {
  "use step";
  const output = await mapCall(
    studentId,
    "map-reading",
    writingCall(input, judged),
    "reading",
  );
  if (output === null) return limitReached;
  if (judged.mode === "annotated") {
    const { notes } = annotationsSchema.parse(output);
    checkAnnotations(notes, input.section);
    return { ok: true, value: { annotations: notes, studyText: null } };
  }
  const { text } = studyTextSchema.parse(output);
  checkStudyText(text, input.section);
  return { ok: true, value: { annotations: null, studyText: text } };
}

/**
 * Makes the stored Reading sections these and, when `complete`, marks the
 * build built, in one transaction. A section with an id keeps its stored
 * mode and texts; a new one is stored with its own. A build that reached its
 * Daily limit stores the sections it judged with `complete` false, so the
 * next build judges only the rest. Does nothing when no build runs any more.
 */
export async function storeReadingSections(
  courseId: string,
  sections: SectionToStore[],
  complete = true,
): Promise<void> {
  "use step";
  const { error } = await createAdminClient().rpc("replace_reading_sections", {
    p_course_id: courseId,
    p_mark_built: complete,
    p_sections: sections.map(({ id, topicId, position, cut, ...rest }) => ({
      id,
      topic: topicId,
      material: cut.materialId,
      position,
      pageFrom: cut.pageFrom,
      pageTo: cut.pageTo,
      chunkIds: cut.chunkIds,
      ...rest,
    })),
  });
  if (error) failed("Storing the reading sections", error);
}
