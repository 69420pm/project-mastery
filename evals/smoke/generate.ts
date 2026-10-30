import { randomUUID } from "node:crypto";
import { loadStoredMap } from "@/features/knowledge-map/server";
import {
  findProblems,
  generateProblems,
  mathRunner,
} from "@/features/study/server";
import { signInAsUser } from "@/lib/supabase/admin";
import { insertRows, seedGoldCourse } from "./gold-course";
import { result, type SmokeCheck } from "./smoke-check";

/**
 * The gold course with the first Topic whose first KC an Exercise tests,
 * that Exercise asked in an earlier session (so the Topic stock's first KC
 * gets its variant). A Learn session then starts on that Topic, queues the
 * Topic stock as the tutor's first reply does, and the real
 * `generateProblems` runs in process: one `generate` call per Problem, two
 * with the retry, at most 4 Problems.
 */
export const generateSmoke: SmokeCheck = {
  name: "generate",
  usage:
    "pnpm smoke generate (the gold course, a Learn session on a Topic with an Exercise of its first KC seen, then one generate run)",
  maxCalls: 10,
  async run({ supabase, studentId }) {
    const gold = await seedGoldCourse(supabase, studentId);
    const { courseId } = gold;
    const owned = { owner: studentId, course_id: courseId };
    const pick = gold.topics.flatMap((topic) => {
      const exercise = gold.exercises.find(
        (e) => !e.reserved && e.kcs.includes(topic.kcs[0] ?? ""),
      );
      return exercise ? [{ topic, exercise }] : [];
    })[0];
    if (!pick) {
      throw new Error(
        "No Exercise of the gold course tests a Topic's first KC.",
      );
    }
    const { topic, exercise } = pick;
    console.info(`Topic: ${topic.name}; seen: ${exercise.label}`);

    // The Exercise was asked in an earlier session, so it is seen.
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
        topic_id: topic.id,
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
        exercise_id: exercise.id,
        prompt: exercise.markdown,
        asked_at: earlier.toISOString(),
      },
    ]);

    // The Learn session's start queues the Topic stock as the Student.
    const client = await signInAsUser(supabase, studentId);
    const queued = await client.rpc("queue_problem_run", {
      p_course_id: courseId,
      p_topic_id: topic.id,
    });
    if (queued.error || !queued.data) {
      throw new Error(`queue_problem_run: ${queued.error?.message ?? "false"}`);
    }
    await generateProblems(courseId);

    const [run, problems] = await Promise.all([
      supabase
        .from("problem_runs")
        .select("status")
        .eq("course_id", courseId)
        .single(),
      supabase
        .from("problems")
        .select(
          "id, source, status, original_exercise_id, statement, solution, program, final_answers, failure",
        )
        .eq("course_id", courseId)
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
      (p) => p.source === "variant" && p.original_exercise_id === exercise.id,
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

    const map = await loadStoredMap(client, courseId);
    const found = await findProblems(client, courseId, map, [topic.kcs[0]!]);

    return [
      result("the run is done", run.data.status === "done", run.data.status),
      result(
        `a ready variant of ${exercise.label}`,
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
