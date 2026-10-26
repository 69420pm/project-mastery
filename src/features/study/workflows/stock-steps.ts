import "server-only";
import { randomUUID } from "node:crypto";
import { getExamFacts } from "@/features/brief/server";
import {
  loadStoredMap,
  loadStoredTopics,
} from "@/features/knowledge-map/server";
import { loadKcPriorities } from "@/features/priorities/server";
import { targetDifficulty } from "@/features/study/domain/exercises";
import {
  dueSoon,
  planReviewStock,
  planTopicStock,
  type PlannedProblem,
} from "@/features/study/domain/problem-stock";
import { kcState, utcDay } from "@/features/study/domain/replay";
import {
  loadReservedChunks,
  withoutReserved,
} from "@/features/study/server/reserved-exam";
import {
  loadAskedProblems,
  loadLastUnassistedSuccess,
  loadSchedules,
} from "@/features/study/server/attempts";
import { createAdminClient } from "@/lib/supabase/admin";
import { allRows } from "@/lib/supabase/all-rows";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The planning and bookkeeping steps of a generate run
 * (`generate-problems.ts`). Each runs on the admin client, since no Student
 * is signed in, and so scopes every query to the Course itself.
 */

/** A Course's generated Problem as planning reads it. */
type StoredProblem = {
  id: string;
  status: string;
  flag: string | null;
  difficulty: number;
  originalExerciseId: string | null;
  kcs: string[];
};

async function loadCourseProblems(
  supabase: Supabase,
  courseId: string,
): Promise<StoredProblem[]> {
  const rows = await allRows("Loading the generated Problems", (from, to) =>
    supabase
      .from("problems")
      .select(
        "id, status, flag, difficulty, original_exercise_id, problem_kcs(kc_id)",
      )
      .eq("course_id", courseId)
      .order("created_at")
      .order("id")
      .range(from, to),
  );
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    flag: row.flag,
    difficulty: row.difficulty,
    originalExerciseId: row.original_exercise_id,
    kcs: row.problem_kcs.map(({ kc_id }) => kc_id),
  }));
}

/** What a run generates: the Student's queued Problems, oldest first. */
export type RunPlan = { studentId: string; problemIds: string[] };

/**
 * Plans the stock of the Course's running run, queues its Problems and
 * returns every queued Problem of the Course, those a reached Daily limit
 * left from earlier runs first. Null when no run runs any more, as when the
 * Course was deleted.
 */
export async function planProblems(
  courseId: string,
  now: Date = new Date(),
): Promise<RunPlan | null> {
  "use step";
  const supabase = createAdminClient();
  const run = await supabase
    .from("problem_runs")
    .select("owner, stock, topic_id")
    .eq("course_id", courseId)
    .eq("status", "running")
    .maybeSingle();
  if (run.error) failed("Loading the generate run", run.error);
  if (!run.data) return null;
  const { owner, stock, topic_id: topicId } = run.data;

  const [storedMap, topics, problems, asked, reserved] = await Promise.all([
    loadStoredMap(supabase, courseId),
    loadStoredTopics(supabase, courseId),
    loadCourseProblems(supabase, courseId),
    loadAskedProblems(supabase, courseId),
    loadReservedChunks(supabase, courseId),
  ]);
  // The reserved exam's Exercises are no stock and no variant source.
  const map = withoutReserved(storedMap, reserved);
  const input = {
    exercises: map.exercises.map((exercise) => ({
      id: exercise.id,
      kcs: exercise.kcs,
      seen: asked.has(exercise.id),
      hasVariant: problems.some((p) => p.originalExerciseId === exercise.id),
    })),
    unseen: [
      ...map.exercises.filter(({ id }) => !asked.has(id)),
      ...problems.filter(
        (p) =>
          p.status === "queued" ||
          (p.status === "ready" && p.flag === null && !asked.has(p.id)),
      ),
    ],
  };
  const planned =
    stock === "topic"
      ? planTopicStock(
          topics.find(({ id }) => id === topicId)?.kcs ?? [],
          input,
        )
      : planReviewStock(await dueKcs(supabase, courseId, map.kcs, now), input);

  const difficulty = new Map([
    ...map.exercises.map((e) => [e.id, e.difficulty] as const),
    ...problems.map((p) => [p.id, p.difficulty] as const),
  ]);
  const exercise = new Map(map.exercises.map((e) => [e.id, e]));
  const rows = await Promise.all(
    planned.map(async (problem: PlannedProblem) => {
      const common = {
        id: randomUUID(),
        owner,
        course_id: courseId,
        status: "queued",
        topic_id: stock === "topic" ? topicId : null,
      };
      if (problem.source === "variant") {
        const original = exercise.get(problem.exerciseId)!;
        return {
          row: {
            ...common,
            source: "variant",
            original_exercise_id: original.id,
            task_type: original.taskType,
            difficulty: original.difficulty,
          },
          kcs: problem.kcs,
        };
      }
      const success = await loadLastUnassistedSuccess(
        supabase,
        courseId,
        problem.kcs,
      );
      return {
        row: {
          ...common,
          source: "new",
          difficulty: targetDifficulty(
            success === null ? null : (difficulty.get(success) ?? null),
          ),
        },
        kcs: problem.kcs,
      };
    }),
  );
  await queueProblems(supabase, owner, courseId, rows);

  const queued = [
    ...problems.filter((p) => p.status === "queued").map((p) => p.id),
    ...rows.map(({ row }) => row.id),
  ];
  return { studentId: owner, problemIds: queued };
}

/** The Course's KCs due within the review window at `now`, soonest first. */
async function dueKcs(
  supabase: Supabase,
  courseId: string,
  kcs: Array<{ id: string }>,
  now: Date,
): Promise<string[]> {
  const [exam, priorities] = await Promise.all([
    getExamFacts(supabase, courseId),
    loadKcPriorities(supabase, courseId),
  ]);
  const schedules = await loadSchedules(
    supabase,
    courseId,
    { examDate: exam.examDate, goal: exam.goal, priorities },
    now,
  );
  return dueSoon(
    kcs.map(({ id }) => ({
      kcId: id,
      nextReview: kcState(schedules.get(id), now).nextReview,
    })),
    utcDay(now),
  );
}

/** Inserts the planned Problems with their KCs. */
export async function queueProblems(
  supabase: Supabase,
  owner: string,
  courseId: string,
  rows: Array<{
    row: TablesInsert<"problems"> & { id: string };
    kcs: string[];
  }>,
): Promise<void> {
  if (rows.length === 0) return;
  const problems = await supabase
    .from("problems")
    .insert(rows.map(({ row }) => row));
  if (problems.error) failed("Queueing the Problems", problems.error);
  const kcs = await supabase.from("problem_kcs").insert(
    rows.flatMap(({ row, kcs }) =>
      kcs.map((kcId) => ({
        problem_id: row.id,
        kc_id: kcId,
        owner,
        course_id: courseId,
      })),
    ),
  );
  if (kcs.error) {
    // Without its KCs a queued Problem would not count as stock.
    await supabase
      .from("problems")
      .delete()
      .in(
        "id",
        rows.map(({ row }) => row.id),
      );
    failed("Queueing the Problems' KCs", kcs.error);
  }
}

/** Marks the Course's running run done. */
export async function finishRun(courseId: string): Promise<void> {
  "use step";
  const { error } = await createAdminClient()
    .from("problem_runs")
    .update({ status: "done" })
    .eq("course_id", courseId)
    .eq("status", "running");
  if (error) failed("Finishing the generate run", error);
}
