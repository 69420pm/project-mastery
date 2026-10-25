import { randomUUID } from "node:crypto";
import { loadStoredMap } from "@/features/knowledge-map/server";
import {
  findProblems,
  generateProblems,
  mathRunner,
} from "@/features/study/server";
import { signInAsUser } from "@/lib/supabase/admin";
import type { AdminSupabase } from "@/lib/supabase/types";
import { insertGoldMap, insertGoldTopics } from "./gold-map";
import { result, type SmokeCheck } from "./smoke-check";

/** The gold Exercise the Student has seen, with real data and a key. */
const THRUST_EXERCISE = {
  name: "Ex. 7.2a",
  markdown:
    "Ex. 7.2a: A turbojet flies at 250 m/s and takes in 50 kg/s of air, which leaves the fully expanded nozzle at 600 m/s. Neglect the fuel's mass flow. Compute the thrust.",
  solution:
    "Solution 7.2a: $F = \\dot m (v_e - v_0) = 50 \\cdot (600 - 250) = 17\\,500$ N $= 17.5$ kN.",
  finalAnswers: [{ label: "Thrust", value: 17.5, unit: "kN" }],
};

async function insertRows(
  supabase: AdminSupabase,
  table: string,
  rows: object[],
) {
  const { error } = await supabase.from(table as "kcs").insert(rows as never);
  if (error) throw new Error(`${table}: ${error.message}`);
}

/**
 * The jet-engines gold map and Topics without model calls, with Ex. 7.2a
 * testing every KC of the thrust Topic (so the Topic stock's first KC gets
 * its variant) and asked in an earlier session. A Learn session then
 * starts on the thrust Topic, queues the Topic stock as the tutor's first
 * reply does, and the real `generateProblems` runs in process: one
 * `generate` call per Problem, two with the retry, at most 4 Problems.
 */
export const generateSmoke: SmokeCheck = {
  name: "generate",
  usage: `pnpm smoke generate (the gold map, a Learn session on the thrust Topic with ${THRUST_EXERCISE.name} seen, then one generate run)`,
  maxCalls: 10,
  async run({ supabase, studentId }) {
    const { data: course, error } = await supabase
      .from("courses")
      .insert({ owner: studentId, name: "Smoke check" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const owned = { owner: studentId, course_id: course.id };
    const goldMap = await insertGoldMap(supabase, studentId, course.id);
    const { gold, id } = goldMap;

    const materialId = randomUUID();
    await insertRows(supabase, "materials", [
      {
        ...owned,
        id: materialId,
        name: "Jet engines",
        media_type: "application/pdf",
        size_bytes: 1,
        storage_path: `${studentId}/${course.id}/${materialId}`,
      },
    ]);
    const chunk = (position: number, label: string, markdown: string) => ({
      ...owned,
      id: randomUUID(),
      material_id: materialId,
      position,
      page_from: position + 1,
      page_to: position + 1,
      label,
      markdown,
    });
    const source = chunk(
      0,
      "content",
      "A jet engine accelerates air rearward, and the reaction pushes the engine forward (Newton's third law). Thrust is the mass flow times the change in velocity: $F = \\dot m (v_e - v_0)$ for a fully expanded nozzle.",
    );
    const questions = gold.exercises.map((exercise, index) =>
      chunk(
        index + 1,
        "exercise",
        exercise.name === THRUST_EXERCISE.name
          ? THRUST_EXERCISE.markdown
          : `${exercise.name}: ${exercise.taskType}. Use the data given in the lecture.`,
      ),
    );
    const thrustIndex = gold.exercises.findIndex(
      ({ name }) => name === THRUST_EXERCISE.name,
    );
    const solution = chunk(
      questions.length + 1,
      "solution",
      THRUST_EXERCISE.solution,
    );
    await insertRows(supabase, "chunks", [source, ...questions, solution]);
    await insertRows(supabase, "exercise_solutions", [
      {
        ...owned,
        exercise_chunk_id: questions[thrustIndex]!.id,
        solution_chunk_id: solution.id,
        status: "paired",
      },
    ]);
    await insertRows(
      supabase,
      "kc_sources",
      gold.kcs
        .filter((kc) => kc.bigIdea !== null)
        .map((kc) => ({ ...owned, kc_id: id(kc.id), chunk_id: source.id })),
    );
    const thrustKcs = gold.kcs.filter((kc) => kc.bigIdea === "BI1");
    const exerciseIds = gold.exercises.map(() => randomUUID());
    await insertRows(
      supabase,
      "exercises",
      gold.exercises.map((exercise, position) => ({
        ...owned,
        id: exerciseIds[position],
        name: exercise.name,
        task_type: exercise.taskType,
        difficulty: exercise.difficulty,
        solution_status: exercise.solutionStatus,
        solution: null,
        question_chunk_id: questions[position]!.id,
        final_answers:
          position === thrustIndex ? THRUST_EXERCISE.finalAnswers : null,
        position,
      })),
    );
    await insertRows(
      supabase,
      "exercise_kcs",
      gold.exercises.flatMap((exercise, position) =>
        (position === thrustIndex
          ? thrustKcs.map((kc) => kc.id)
          : exercise.kcs
        ).map((kc) => ({
          ...owned,
          exercise_id: exerciseIds[position],
          kc_id: id(kc),
        })),
      ),
    );
    const topicIds = await insertGoldTopics(
      supabase,
      studentId,
      course.id,
      goldMap,
    );
    const thrustTopic = topicIds.get("BI1")!;
    const thrustExerciseId = exerciseIds[thrustIndex]!;

    // Ex. 7.2a was asked in an earlier session, so it is seen.
    const earlier = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const session = { id: randomUUID(), owner: studentId };
    await insertRows(supabase, "study_sessions", [
      {
        ...owned,
        ...session,
        mode: "learn",
        topic_id: null,
        stage: null,
        started_at: earlier.toISOString(),
        ended_at: earlier.toISOString(),
      },
      {
        ...owned,
        id: randomUUID(),
        mode: "learn",
        topic_id: thrustTopic,
        stage: "orient",
        started_at: new Date().toISOString(),
        ended_at: null,
      },
    ]);
    await insertRows(supabase, "questions", [
      {
        owner: studentId,
        session_id: session.id,
        kind: "question",
        exercise_id: thrustExerciseId,
        prompt: THRUST_EXERCISE.markdown,
        asked_at: earlier.toISOString(),
      },
    ]);

    // The Learn session's start queues the Topic stock as the Student.
    const client = await signInAsUser(supabase, studentId);
    const queued = await client.rpc("queue_problem_run", {
      p_course_id: course.id,
      p_topic_id: thrustTopic,
    });
    if (queued.error || !queued.data) {
      throw new Error(`queue_problem_run: ${queued.error?.message ?? "false"}`);
    }
    await generateProblems(course.id);

    const [run, problems] = await Promise.all([
      supabase
        .from("problem_runs")
        .select("status")
        .eq("course_id", course.id)
        .single(),
      supabase
        .from("problems")
        .select(
          "id, source, status, original_exercise_id, statement, solution, program, final_answers, failure",
        )
        .eq("course_id", course.id)
        .order("created_at"),
    ]);
    if (run.error) throw new Error(run.error.message);
    if (problems.error) throw new Error(problems.error.message);
    for (const problem of problems.data) {
      console.info(
        `\n${problem.source} (${problem.status})${problem.failure ? `: ${problem.failure}` : ""}\n${problem.statement ?? ""}\n--- Solution\n${problem.solution ?? ""}\n--- Program\n${problem.program ?? "none"}\n--- Final answers ${JSON.stringify(problem.final_answers)}`,
      );
    }
    const ready = problems.data.filter((p) => p.status === "ready");
    const variant = ready.find(
      (p) =>
        p.source === "variant" && p.original_exercise_id === thrustExerciseId,
    );

    const rerun = await Promise.all(
      ready
        .filter((p) => p.program !== null)
        .map(async (p) => {
          const stored = (p.final_answers ?? []) as Array<{
            label: string;
            value: number;
            unit: string | null;
          }>;
          const again = await mathRunner.run(
            p.program!,
            stored.map(({ label, unit }) => ({ variable: label, unit })),
          );
          const same =
            again.ok &&
            again.answers.length === stored.length &&
            again.answers.every(
              (answer, i) => answer.value === stored[i]!.value,
            );
          return { id: p.id, same };
        }),
    );

    const map = await loadStoredMap(client, course.id);
    const thrustKc = gold.exercises[thrustIndex]!.kcs[0]!;
    const found = await findProblems(client, course.id, map, [id(thrustKc)]);

    return [
      result("the run is done", run.data.status === "done", run.data.status),
      result(
        `a ready variant of ${THRUST_EXERCISE.name}`,
        variant !== undefined,
        problems.data
          .map(
            (p) =>
              `${p.source} ${p.status}${p.failure ? ` (${p.failure})` : ""}`,
          )
          .join("; "),
      ),
      result(
        "no {{ is left in a ready Problem",
        ready.every((p) => !`${p.statement} ${p.solution}`.includes("{{")),
      ),
      result(
        "the final answers equal a re-run of the stored program",
        rerun.every(({ same }) => same),
        `${rerun.filter(({ same }) => same).length} of ${rerun.length}`,
      ),
      result(
        "findProblems returns the variant",
        variant !== undefined &&
          found.problems.some(({ id: problemId }) => problemId === variant.id),
        found.problems.map((p) => `${p.name} (${p.source})`).join(", ") ||
          found.note,
      ),
    ];
  },
};
