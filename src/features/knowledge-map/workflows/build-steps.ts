import "server-only";
import type { z } from "zod";
import { UNIT_MARK } from "@/features/knowledge-map/ai/chapter-extraction";
import {
  chapterUnits,
  unitHash,
} from "@/features/knowledge-map/domain/chapter-units";
import type { UnitExtraction } from "@/features/knowledge-map/domain/chapter-extraction";
import { courseLanguage } from "@/features/knowledge-map/domain/course-language";
import type { StoredExtraction } from "@/features/knowledge-map/schemas";
import { meteredStream } from "@/features/usage/server";
import { getAiEnv } from "@/lib/ai/env";
import { allRows } from "@/lib/supabase/all-rows";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";
import type { AdminSupabase } from "@/lib/supabase/types";

/**
 * The steps of a Knowledge map update (`build-knowledge-map.ts`) that
 * prepare and end it, and what every step shares. Each runs on the admin
 * client, since no Student is signed in, and so scopes every query to the
 * Course itself. Each starts with `touchBuild`, which sets the build's
 * heartbeat, and does nothing once the build no longer runs.
 */

/** The most units one step extracts or consolidates. */
export const UNITS_PER_STEP = 8;

/**
 * How long after its start a step may still start a model call. Later
 * calls are left to the next step, so a step ends within Vercel Hobby's
 * 300-second limit even at MiMo's pace.
 */
const CALL_WINDOW_MS = 150_000;

/**
 * What a step did: how many units it left for the next step, or null when
 * the build no longer runs; or why the build stops.
 */
export type StepOutcome =
  { ok: true; left: number | null } | { ok: false; reason: string };

/**
 * Sets the running build's heartbeat, so `queue_knowledge_map_build` sees
 * it alive, and returns the Course's owner. Null when no build runs.
 */
export async function touchBuild(
  supabase: AdminSupabase,
  courseId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("knowledge_map_builds")
    .update({ heartbeat_at: new Date().toISOString() })
    .eq("course_id", courseId)
    .eq("status", "building")
    .select("owner")
    .maybeSingle();
  if (error) failed("Recording the build's heartbeat", error);
  return data?.owner ?? null;
}

/**
 * Runs `call` on each item, at most AI_CONCURRENCY at a time, and starts
 * none after CALL_WINDOW_MS, nor once a call returned "stop". The first
 * always starts.
 */
export async function runCalls<Item>(
  items: readonly Item[],
  call: (item: Item) => Promise<"stop" | void>,
): Promise<void> {
  const startedAt = Date.now();
  const queue = [...items];
  let started = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped) {
      if (started > 0 && Date.now() - startedAt > CALL_WINDOW_MS) return;
      const item = queue.shift();
      if (item === undefined) return;
      started += 1;
      if ((await call(item)) === "stop") stopped = true;
    }
  };
  await Promise.all(
    Array.from({ length: getAiEnv().AI_CONCURRENCY }, () => worker()),
  );
}

/**
 * One structured call of the build, streamed and metered, its answer
 * parsed with `schema`. A call whose answer is empty or no valid output is
 * made once more; a second such answer fails the step. "limit" when the
 * Daily limit is reached.
 */
export async function buildCall<Schema extends z.ZodType>(
  supabase: AdminSupabase,
  scope: Parameters<typeof meteredStream>[1],
  call: Parameters<typeof meteredStream>[2],
  schema: Schema,
): Promise<z.infer<Schema> | "limit"> {
  for (let attempt = 1; ; attempt += 1) {
    const result = await meteredStream(supabase, scope, call);
    if (!result) return "limit";
    try {
      return schema.parse(await result.output);
    } catch (error) {
      if (attempt >= 2) throw error;
      console.warn(`The ${scope.traceName} call gave no answer; once more.`);
    }
  }
}

/** A unit of the Course, as the build reads it. */
export type CourseUnit = {
  chapterId: string;
  kind: "content" | "exercise";
  unit: number;
  contentHash: string;
  materialName: string;
  /** The Material's Outline, with the unit's Chapter marked. */
  outline: string[];
  chunks: Array<{ id: string; markdown: string }>;
};

/**
 * The Course's units of one kind in Course order: Materials by position,
 * then their units in reading order (`chapterUnits`).
 */
export async function loadCourseUnits(
  supabase: AdminSupabase,
  courseId: string,
  kind: CourseUnit["kind"],
): Promise<CourseUnit[]> {
  const [materials, chapters, chunks] = await Promise.all([
    supabase
      .from("materials")
      .select("id, name")
      .eq("course_id", courseId)
      .order("position"),
    allRows("Loading the Chapters", (from, to) =>
      supabase
        .from("chapters")
        .select("id, material_id, parent_id, depth, title")
        .eq("course_id", courseId)
        .order("material_id")
        .order("position")
        .range(from, to),
    ),
    allRows("Loading the chunks", (from, to) =>
      supabase
        .from("chunks")
        .select("id, material_id, chapter_id, markdown")
        .eq("course_id", courseId)
        .eq("label", kind)
        .order("material_id")
        .order("position")
        .range(from, to),
    ),
  ]);
  if (materials.error) failed("Loading the Materials", materials.error);
  return materials.data.flatMap((material) => {
    const outline = chapters.filter((c) => c.material_id === material.id);
    const ofMaterial = chunks.filter((c) => c.material_id === material.id);
    const chunkOf = new Map(ofMaterial.map((chunk) => [chunk.id, chunk]));
    const titleOf = new Map(outline.map((c) => [c.id, c.title]));
    return chapterUnits(
      outline.map((c) => ({ id: c.id, parentId: c.parent_id })),
      ofMaterial.map((c) => ({
        id: c.id,
        chapterId: c.chapter_id,
        markdown: c.markdown,
      })),
    ).map((unit) => {
      const unitChunks = unit.chunkIds.map((id) => {
        const { markdown } = chunkOf.get(id)!;
        return { id, markdown };
      });
      return {
        chapterId: unit.chapterId,
        kind,
        unit: unit.unit,
        contentHash: unitHash(
          titleOf.get(unit.chapterId) ?? "",
          unitChunks.map((chunk) => chunk.markdown),
        ),
        materialName: material.name,
        outline: outline.map(
          (c) =>
            `${"  ".repeat(c.depth)}${c.title}${c.id === unit.chapterId ? UNIT_MARK : ""}`,
        ),
        chunks: unitChunks,
      };
    });
  });
}

/** A unit's key among the stored extractions. */
export const unitKey = (unit: {
  chapterId: string;
  kind: string;
  unit: number;
}) => `${unit.chapterId}/${unit.kind}/${unit.unit}`;

/** A stored unit extraction, keyed as `unitKey`. */
export type StoredUnit = {
  id: string;
  key: string;
  contentHash: string;
  output: unknown;
  kcIds: string[] | null;
  assumesMatched: boolean;
};

/** The Course's stored unit extractions. */
export async function loadStoredUnits(
  supabase: AdminSupabase,
  courseId: string,
): Promise<StoredUnit[]> {
  const rows = await allRows("Loading the unit extractions", (from, to) =>
    supabase
      .from("chapter_extractions")
      .select(
        "id, chapter_id, kind, unit, content_hash, output, kc_ids, assumes_matched",
      )
      .eq("course_id", courseId)
      .order("id")
      .range(from, to),
  );
  return rows.map((row) => ({
    id: row.id,
    key: unitKey({ chapterId: row.chapter_id, kind: row.kind, unit: row.unit }),
    contentHash: row.content_hash,
    output: row.output,
    kcIds: row.kc_ids,
    assumesMatched: row.assumes_matched,
  }));
}

/**
 * Stores a unit's extraction, replacing an earlier one, as not consolidated
 * and not matched yet.
 */
export async function storeExtraction(
  supabase: AdminSupabase,
  {
    owner,
    courseId,
    unit,
  }: { owner: string; courseId: string; unit: CourseUnit },
  output: UnitExtraction | StoredExtraction,
) {
  const { error } = await supabase.from("chapter_extractions").upsert(
    {
      chapter_id: unit.chapterId,
      kind: unit.kind,
      unit: unit.unit,
      owner,
      course_id: courseId,
      content_hash: unit.contentHash,
      output,
      kc_ids: null,
      assumes_matched: false,
    },
    { onConflict: "chapter_id,kind,unit" },
  );
  if (error) failed("Storing a unit extraction", error);
}

/**
 * The Course's stored extractions of current units, in Course order:
 * teaching units first, then exercise units. Extractions of units that no
 * longer exist are deleted.
 */
export async function loadCurrentExtractions(
  supabase: AdminSupabase,
  courseId: string,
): Promise<StoredUnit[]> {
  const [content, exercise, stored] = await Promise.all([
    loadCourseUnits(supabase, courseId, "content"),
    loadCourseUnits(supabase, courseId, "exercise"),
    loadStoredUnits(supabase, courseId),
  ]);
  const order = new Map(
    [...content, ...exercise].map((unit, index) => [unitKey(unit), index]),
  );
  const gone = stored.filter((row) => !order.has(row.key));
  if (gone.length > 0) {
    const { error } = await supabase
      .from("chapter_extractions")
      .delete()
      .in(
        "id",
        gone.map((row) => row.id),
      );
    if (error) failed("Deleting the extractions of gone units", error);
  }
  return stored
    .filter((row) => order.has(row.key))
    .toSorted((a, b) => order.get(a.key)! - order.get(b.key)!);
}

/**
 * The Course language: the most common language of its Materials; English
 * when none has one.
 */
export async function loadCourseLanguage(
  supabase: AdminSupabase,
  courseId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("materials")
    .select("language")
    .eq("course_id", courseId)
    .order("position");
  if (error) failed("Loading the Materials' languages", error);
  return courseLanguage(data.map((material) => material.language));
}

/**
 * Prepares a build: "nothing" when the Course has no content or exercise
 * chunks, "stopped" when the build no longer runs. Retires the KCs whose
 * sources are all gone.
 */
export async function prepareBuild(
  courseId: string,
): Promise<"ready" | "nothing" | "stopped"> {
  "use step";
  const supabase = createAdminClient();
  if (!(await touchBuild(supabase, courseId))) return "stopped";
  const chunks = await supabase
    .from("chunks")
    .select("id")
    .eq("course_id", courseId)
    .in("label", ["content", "exercise"])
    .limit(1);
  if (chunks.error) failed("Loading the chunks", chunks.error);
  if (chunks.data.length === 0) return "nothing";
  await retireUnsourcedKcs(supabase, courseId);
  return "ready";
}

/** Retires the Course's live KCs whose sources are all gone. */
export async function retireUnsourcedKcs(
  supabase: AdminSupabase,
  courseId: string,
) {
  const { error } = await supabase.rpc("retire_unsourced_kcs", {
    p_course_id: courseId,
  });
  if (error) failed("Retiring the KCs without sources", error);
}

/** Marks the running build failed with a reason for the Student. */
export async function failBuild(
  courseId: string,
  reason: string,
): Promise<void> {
  "use step";
  const { error } = await createAdminClient()
    .from("knowledge_map_builds")
    .update({ status: "failed", failure_reason: reason })
    .eq("course_id", courseId)
    .eq("status", "building");
  if (error) failed("Recording the failed build", error);
}
