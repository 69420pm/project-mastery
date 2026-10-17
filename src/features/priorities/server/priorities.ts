import "server-only";
import { start } from "workflow/api";
import { z } from "zod";
import type { MapPriorities } from "@/features/knowledge-map";
import { priorityLevels } from "@/features/priorities/domain/priority";
import { updatePriorities } from "@/features/priorities/workflows/update-priorities";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The lazy start of the map page: queues a priority run of the signed-in
 * Student's Course when its map is built, none runs and the last one is
 * older than the map, the Brief or a Finding answer (`queue_priority_run`),
 * and starts the `updatePriorities` workflow. When the workflow cannot
 * start, the run is failed and the error is logged, not thrown.
 */
export async function ensurePriorities(courseId: string): Promise<void> {
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) return;
  const supabase = await createClient();
  const { data: queued, error } = await supabase.rpc("queue_priority_run", {
    course_id: courseId,
  });
  if (error)
    throw new Error(`Queueing the priorities failed: ${error.message}`);
  if (!queued) return;
  try {
    await start(updatePriorities, [courseId]);
  } catch (startError) {
    console.error("Starting the priority run failed:", startError);
    const { error: recordError } = await supabase.rpc(
      "record_priority_run_start_failure",
      { course_id: courseId },
    );
    if (recordError) {
      console.error("Recording a failed priority start failed:", recordError);
    }
  }
}

/**
 * Each KC's Priority of a Course by KC id, read with `supabase`, a Student's
 * session client; empty before the first run.
 */
export async function loadKcPriorities(
  supabase: Supabase,
  courseId: string,
): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("kc_priorities")
    .select("kc_id, priority")
    .eq("course_id", courseId);
  if (error) throw new Error(`Loading the priorities failed: ${error.message}`);
  return Object.fromEntries(
    data.map((row) => [row.kc_id, Number(row.priority)]),
  );
}

/**
 * The signed-in Student's KC priorities of a Course as the map page shows
 * them: each KC's level and reasons, and whether a run is running or the
 * last one failed. No KCs before the first run; an unknown or another
 * Student's Course reads as never run.
 */
export async function getPriorities(courseId: string): Promise<MapPriorities> {
  const none: MapPriorities = { running: false, failureReason: null, kcs: {} };
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) return none;
  const supabase = await createClient();
  const [run, rows] = await Promise.all([
    supabase
      .from("priority_runs")
      .select("status, failure_reason")
      .eq("course_id", courseId)
      .maybeSingle(),
    supabase
      .from("kc_priorities")
      .select("kc_id, priority, multiplier, reasons")
      .eq("course_id", courseId),
  ]);
  if (run.error) {
    throw new Error(`Loading the priority run failed: ${run.error.message}`);
  }
  if (rows.error) {
    throw new Error(`Loading the priorities failed: ${rows.error.message}`);
  }

  const levels = priorityLevels(
    rows.data.map((row) => ({
      kcId: row.kc_id,
      priority: Number(row.priority),
      multiplier: Number(row.multiplier),
    })),
  );
  return {
    running: run.data?.status === "running",
    failureReason: run.data?.failure_reason ?? null,
    kcs: Object.fromEntries(
      rows.data.map((row) => [
        row.kc_id,
        {
          level: levels.get(row.kc_id) ?? "low",
          value: Number(row.priority),
          multiplier: Number(row.multiplier),
          reasons: row.reasons,
        },
      ]),
    ),
  };
}
