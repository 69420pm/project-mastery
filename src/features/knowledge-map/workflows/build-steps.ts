import "server-only";
import { courseLanguage } from "@/features/knowledge-map/domain/course-order";
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

/** The most Parts one step extracts or consolidates. */
export const PARTS_PER_STEP = 8;

/**
 * How long after its start a step may still start a model call. Later
 * calls are left to the next step, so a step ends within Vercel Hobby's
 * 300-second limit even at MiMo's pace.
 */
const CALL_WINDOW_MS = 150_000;

/**
 * What a step did: how many Parts it left for the next step, or null when
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

/** A Part of the Course, as the build reads it. */
export type CoursePart = {
  id: string;
  materialId: string;
  kind: "teaching" | "exercise";
  title: string;
  chapterTitle: string;
  contentHash: string;
};

/** The Course's Parts in Course order: Materials by position, then Parts. */
export async function loadCourseParts(
  supabase: AdminSupabase,
  courseId: string,
): Promise<CoursePart[]> {
  const [materials, parts] = await Promise.all([
    supabase
      .from("materials")
      .select("id")
      .eq("course_id", courseId)
      .order("position"),
    allRows("Loading the Parts", (from, to) =>
      supabase
        .from("parts")
        .select(
          "id, material_id, position, kind, title, chapter_title, content_hash",
        )
        .eq("course_id", courseId)
        .order("material_id")
        .order("position")
        .range(from, to),
    ),
  ]);
  if (materials.error) failed("Loading the Materials", materials.error);
  return materials.data.flatMap((material) =>
    parts
      .filter((part) => part.material_id === material.id)
      .map((part) => ({
        id: part.id,
        materialId: part.material_id,
        kind: part.kind as CoursePart["kind"],
        title: part.title,
        chapterTitle: part.chapter_title,
        contentHash: part.content_hash,
      })),
  );
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
 * Prepares a build: "nothing" when the Course has no Parts, "stopped" when
 * the build no longer runs. Retires the KCs whose sources are all gone.
 */
export async function prepareBuild(
  courseId: string,
): Promise<"ready" | "nothing" | "stopped"> {
  "use step";
  const supabase = createAdminClient();
  if (!(await touchBuild(supabase, courseId))) return "stopped";
  const parts = await supabase
    .from("parts")
    .select("id")
    .eq("course_id", courseId)
    .limit(1);
  if (parts.error) failed("Loading the Parts", parts.error);
  if (parts.data.length === 0) return "nothing";
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
