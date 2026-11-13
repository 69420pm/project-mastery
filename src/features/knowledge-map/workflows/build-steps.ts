import "server-only";
import { UNIT_MARK } from "@/features/knowledge-map/ai/chapter-extraction";
import {
  chapterUnits,
  unitHash,
} from "@/features/knowledge-map/domain/chapter-units";
import { keptFailingReason } from "@/features/knowledge-map/domain/build-failure";
import type { UnitExtraction } from "@/features/knowledge-map/domain/chapter-extraction";
import {
  examChapterIds,
  loadCourseLanguage as loadLanguage,
} from "@/features/ingestion/server";
import {
  storedExtractionSchema,
  type StoredExtraction,
} from "@/features/knowledge-map/schemas";
import { RateLimited } from "@/features/knowledge-map/workflows/build-call";
import {
  givenUp,
  joinExtractions,
  partialHash,
  unitPieces,
  type UnitPiece,
} from "@/features/knowledge-map/domain/unit-pieces";
import { BUILD_CALL_TIMEOUT_MS, callFits } from "@/lib/ai/call-timeout";
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
 * What a step did: how many units it left for the next step, or null when
 * the build no longer runs, and the keys (`unitKey`) of the units whose
 * call failed, left to the next step; with `waitMs` when the Gateway's rate
 * limit turned a call away, so the workflow waits that long before the next
 * step; or why the build stops.
 */
export type StepOutcome =
  | { ok: true; left: number | null; failed?: string[]; waitMs?: number }
  | { ok: false; reason: string };

/**
 * A step of the build that the workflow calls until it leaves nothing,
 * passing the keys of the units whose call failed, once per failure.
 */
export type BuildStep = (
  courseId: string,
  failed: readonly string[],
) => Promise<StepOutcome>;

/**
 * The outcome of a step that left `left` units, of which those keyed in
 * `failedKeys` because their call failed. A unit that failed once before
 * stops the build with a reason naming its Chapter, without a throw, so
 * the workflow does not retry the step. Nothing is stored for the unit, so
 * Update map tries it again.
 */
export async function stepOutcome(
  supabase: AdminSupabase,
  {
    left,
    failedKeys,
    failedOnce,
    waitMs,
  }: {
    left: number;
    failedKeys: Iterable<string>;
    failedOnce: readonly string[];
    waitMs?: number;
  },
): Promise<StepOutcome> {
  const keys = [...new Set(failedKeys)];
  const again = keys.find((key) => failedOnce.includes(key));
  if (again === undefined) return { ok: true, left, failed: keys, waitMs };
  const { data, error } = await supabase
    .from("chapters")
    .select("title")
    .eq("id", again.split("/")[0]!)
    .maybeSingle();
  if (error) failed("Loading the Chapter", error);
  return { ok: false, reason: keptFailingReason(data?.title ?? "a Chapter") };
}

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
 * none once a call returned "stop", nor when one could no longer end in
 * time for a step that started at `stepStartedAt` (`callFits` with
 * BUILD_CALL_TIMEOUT_MS): in practice, one round of calls per step.
 */
export async function runCalls<Item>(
  items: readonly Item[],
  call: (item: Item) => Promise<"stop" | void>,
  stepStartedAt: number,
): Promise<void> {
  const queue = [...items];
  let stopped = false;
  const worker = async () => {
    while (!stopped && callFits(stepStartedAt, BUILD_CALL_TIMEOUT_MS)) {
      const item = queue.shift();
      if (item === undefined) return;
      if ((await call(item)) === "stop") stopped = true;
    }
  };
  await Promise.all(
    Array.from({ length: getAiEnv().AI_CONCURRENCY }, () => worker()),
  );
}

/** A unit of the Course, as the build reads it. */
export type CourseUnit = {
  chapterId: string;
  kind: "content" | "exercise";
  unit: number;
  /** Its Chapter's title; a packed unit's Chapters' titles, joined. */
  title: string;
  contentHash: string;
  materialName: string;
  /** The Material's Outline, with the unit's Chapters marked. */
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
        .select("id, material_id, parent_id, depth, title, is_exam")
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
  // Old exams teach nothing: their chunks form no teaching units. Their
  // exercise chunks still form exercise units.
  const exams =
    kind === "content"
      ? examChapterIds(
          chapters.map((c) => ({
            id: c.id,
            parentId: c.parent_id,
            isExam: c.is_exam === true,
          })),
        )
      : new Set<string>();
  const rootOf = new Map(
    chapters.filter((c) => c.parent_id === null).map((c) => [c.material_id, c]),
  );
  return materials.data.flatMap((material) => {
    const outline = chapters.filter((c) => c.material_id === material.id);
    const ofMaterial = chunks.filter(
      (c) =>
        c.material_id === material.id &&
        !exams.has(c.chapter_id ?? rootOf.get(material.id)?.id ?? ""),
    );
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
      const title = unit.chapterIds
        .map((id) => titleOf.get(id) ?? "")
        .join(", ");
      return {
        chapterId: unit.chapterId,
        kind,
        unit: unit.unit,
        title,
        contentHash: unitHash(
          title,
          unitChunks.map((chunk) => chunk.markdown),
        ),
        materialName: material.name,
        outline: outline.map(
          (c) =>
            `${"  ".repeat(c.depth)}${c.title}${unit.chapterIds.includes(c.id) ? UNIT_MARK : ""}`,
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
 * and not matched yet; with `partial`, as the pieces answered so far
 * (`partialHash`).
 */
export async function storeExtraction(
  supabase: AdminSupabase,
  {
    owner,
    courseId,
    unit,
  }: { owner: string; courseId: string; unit: CourseUnit },
  output: UnitExtraction | StoredExtraction,
  partial = false,
) {
  const { error } = await supabase.from("chapter_extractions").upsert(
    {
      chapter_id: unit.chapterId,
      kind: unit.kind,
      unit: unit.unit,
      owner,
      course_id: courseId,
      content_hash: partial ? partialHash(unit.contentHash) : unit.contentHash,
      output,
      kc_ids: null,
      assumes_matched: false,
    },
    { onConflict: "chapter_id,kind,unit" },
  );
  if (error) failed("Storing a unit extraction", error);
}

/**
 * The extraction steps' units to call, after the units of `failed` (a key
 * once per failed attempt) failed: those that failed less first, so a
 * failed unit waits until the others ran, each with its pieces still to
 * call (`unitPieces`) and the partial extraction it keeps. Units given up
 * on (`givenUp`) are left out.
 */
export function planAttempts(
  todo: readonly CourseUnit[],
  stored: readonly StoredUnit[],
  failed: readonly string[],
): UnitAttempt[] {
  const storedOf = new Map(stored.map((row) => [row.key, row]));
  return todo
    .map((unit) => {
      const key = unitKey(unit);
      const failures = failed.filter((k) => k === key).length;
      const sizes = unit.chunks.map((chunk) => chunk.markdown.length);
      const row = storedOf.get(key);
      const kept =
        row && row.contentHash === partialHash(unit.contentHash)
          ? storedExtractionSchema.parse(row.output)
          : null;
      const read = new Set(kept?.readChunkIds ?? []);
      const pieces = unitPieces(sizes, failures).filter((piece) =>
        unit.chunks
          .slice(piece.start, piece.end)
          .some((chunk) => !read.has(chunk.id)),
      );
      return {
        unit,
        failures,
        kept,
        pieces,
        givenUp: givenUp(sizes, failures),
      };
    })
    .filter((attempt) => !attempt.givenUp)
    .toSorted((a, b) => a.failures - b.failures);
}

/** One unit's attempt in an extraction step. */
export type UnitAttempt = {
  unit: CourseUnit;
  failures: number;
  /** The partial extraction of its pieces answered before. */
  kept: StoredExtraction | null;
  /** Its pieces still to call. */
  pieces: UnitPiece[];
};

/**
 * Calls the pieces of up to UNITS_PER_STEP attempts, as one round
 * (`runCalls`), and stores each unit's extraction: whole once every piece
 * is answered, else partial with the pieces answered so far. A unit with a
 * failed piece is in `failedKeys`; `limit` when the Daily limit stopped a
 * call. A piece the rate limit turned away is neither answered nor failed,
 * and no further call starts: `waitMs` is the longest wait it named.
 */
export async function extractAttempts(
  supabase: AdminSupabase,
  scope: { owner: string; courseId: string },
  attempts: readonly UnitAttempt[],
  callPiece: (
    unit: CourseUnit,
    chunks: CourseUnit["chunks"],
  ) => Promise<StoredExtraction | "limit" | "failed" | RateLimited>,
  startedAt: number,
): Promise<{
  done: number;
  failedKeys: string[];
  limit: boolean;
  waitMs?: number;
}> {
  const batch = attempts.slice(0, UNITS_PER_STEP);
  const answered = batch.map(
    () => [] as Array<{ start: number; extraction: StoredExtraction }>,
  );
  const failedUnits = new Set<number>();
  let limit = false;
  let waitMs: number | undefined;
  await runCalls(
    batch.flatMap((attempt, index) =>
      attempt.pieces.map((piece) => ({ index, piece })),
    ),
    async ({ index, piece }) => {
      const { unit } = batch[index]!;
      const chunks = unit.chunks.slice(piece.start, piece.end);
      const extraction = await callPiece(unit, chunks);
      if (extraction === "limit") {
        limit = true;
        return "stop";
      }
      if (extraction instanceof RateLimited) {
        waitMs = Math.max(waitMs ?? 0, extraction.waitMs);
        return "stop";
      }
      if (extraction === "failed") {
        failedUnits.add(index);
        return;
      }
      answered[index]!.push({
        start: piece.start,
        extraction: {
          ...extraction,
          readChunkIds: chunks.map((chunk) => chunk.id),
        },
      });
    },
    startedAt,
  );

  let done = 0;
  for (const [index, attempt] of batch.entries()) {
    const fresh = answered[index]!.toSorted((a, b) => a.start - b.start);
    const complete = fresh.length === attempt.pieces.length;
    if (fresh.length === 0 && !complete) continue;
    const joined = joinExtractions([
      ...(attempt.kept ? [attempt.kept] : []),
      ...fresh.map((part) => part.extraction),
    ]);
    if (complete) {
      await storeExtraction(
        supabase,
        { ...scope, unit: attempt.unit },
        { ...joined, readChunkIds: undefined },
      );
      done += 1;
    } else {
      await storeExtraction(
        supabase,
        { ...scope, unit: attempt.unit },
        joined,
        true,
      );
    }
  }
  return {
    done,
    failedKeys: [...failedUnits].map((index) => unitKey(batch[index]!.unit)),
    limit,
    waitMs,
  };
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
 * The Course language by name: the one the Student asked for in the
 * Brief, else the most common language of its Materials; English when none
 * has one.
 */
export async function loadCourseLanguage(
  supabase: AdminSupabase,
  courseId: string,
): Promise<string> {
  return (await loadLanguage(supabase, courseId)).name;
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
  // This build reads the Course as it is now; a change from here on marks
  // the map again.
  const cleared = await supabase
    .from("knowledge_map_builds")
    .update({ needs_update: false })
    .eq("course_id", courseId);
  if (cleared.error) failed("Clearing the map's update mark", cleared.error);
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
