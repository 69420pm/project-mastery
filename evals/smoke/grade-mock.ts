import { randomUUID } from "node:crypto";
import { gradeMock } from "@/features/study/server";
import { signInAsUser } from "@/lib/supabase/admin";
import { result, type SmokeCheck } from "./smoke-check";
import { insertGoldCourse, sendMessage, THRUST_EXERCISE } from "./tutor";

/** The blank task: the biggest loss, so the Results session starts on it. */
const BLANK_PROMPT =
  "Ex. 7.1: An ideal Brayton cycle has a pressure ratio of 12. Taking gamma = 1.4 for air, compute the thermal efficiency of the cycle.";

const CORRECT_ANSWER =
  "F = m (v_e - v_0) = 50 kg/s × (600 - 250) m/s = 17,500 N = 17.5 kN.";

/** The thrust formula without the flight speed: a final value off the key. */
const WRONG_ANSWER = "F = m × v_e = 50 kg/s × 600 m/s = 30,000 N = 30 kN.";

const OPENING = "Let's go through the mock.";

/**
 * The gold Course with a submitted mock of 3 tasks: the thrust Exercise
 * answered correctly and with a final value off its key, and the Brayton
 * Exercise left blank. The real `gradeMock` runs in process: the mock must
 * reach `graded`, the blank task scores 0 without a call, the wrong value
 * scores less than full and the correct one at least half. Then one reply
 * of a Results session on the mock must start on the biggest loss, the
 * blank task, and ask for the approach without giving the key's value.
 */
export const gradeMockSmoke: SmokeCheck = {
  name: "grade-mock",
  usage:
    "pnpm smoke grade-mock (the gold Course with a submitted mock of a correct, a wrong and a blank task, graded, then one Results-session reply)",
  // The spec's budget: 2 grading calls, the reply and the Chat's title.
  maxCalls: 4,
  async run({ supabase, studentId }) {
    const { courseId, gold, exerciseIds, thrustExerciseId } =
      await insertGoldCourse(supabase, studentId);
    const blankExerciseId =
      exerciseIds[gold.exercises.findIndex(({ name }) => name === "Ex. 7.1")];
    if (!blankExerciseId) throw new Error("The gold map has no Ex. 7.1.");

    const mockId = randomUUID();
    const mock = await supabase.from("mock_exams").insert({
      id: mockId,
      owner: studentId,
      course_id: courseId,
      status: "ready",
      duration_minutes: 20,
      predicted_score: 10,
    });
    if (mock.error) throw new Error(mock.error.message);
    const tasks = [
      {
        exercise: thrustExerciseId,
        prompt: THRUST_EXERCISE.markdown,
        points: 6,
      },
      {
        exercise: thrustExerciseId,
        prompt: THRUST_EXERCISE.markdown,
        points: 6,
      },
      { exercise: blankExerciseId, prompt: BLANK_PROMPT, points: 8 },
    ];
    const items = await supabase.from("mock_items").insert(
      tasks.map((task, position) => ({
        mock_id: mockId,
        owner: studentId,
        position,
        exercise_id: task.exercise,
        prompt: task.prompt,
        points: task.points,
        predicted_success: 0.5,
      })),
    );
    if (items.error) throw new Error(items.error.message);

    const client = await signInAsUser(supabase, studentId);
    const started = await client.rpc("start_mock_exam", { p_mock_id: mockId });
    if (started.error || !started.data) {
      throw new Error(
        `start_mock_exam: ${started.error?.message ?? "refused"}`,
      );
    }
    const stored = await supabase
      .from("mock_items")
      .select("id, position, question_id")
      .eq("mock_id", mockId)
      .order("position");
    if (stored.error) throw new Error(stored.error.message);
    const answers = [CORRECT_ANSWER, WRONG_ANSWER];
    for (const [position, answer] of answers.entries()) {
      const questionId = stored.data[position]?.question_id;
      if (!questionId) throw new Error("A started mock item has no Question.");
      const saved = await supabase
        .from("questions")
        .update({
          answer_text: answer,
          confidence: 3,
          answered_at: new Date().toISOString(),
        })
        .eq("id", questionId);
      if (saved.error) throw new Error(saved.error.message);
    }
    const submitted = await client.rpc("submit_mock_exam", {
      p_mock_id: mockId,
    });
    if (submitted.error || !submitted.data) {
      throw new Error(
        `submit_mock_exam: ${submitted.error?.message ?? "refused"}`,
      );
    }

    await gradeMock(mockId);

    const [graded, gradedItems, usage] = await Promise.all([
      supabase
        .from("mock_exams")
        .select("status, score, brier")
        .eq("id", mockId)
        .single(),
      supabase
        .from("mock_items")
        .select("position, points, points_awarded, graded_at")
        .eq("mock_id", mockId)
        .order("position"),
      supabase
        .from("ai_usage")
        .select("id")
        .eq("owner", studentId)
        .eq("task", "grade_exam"),
    ]);
    if (graded.error) throw new Error(graded.error.message);
    if (gradedItems.error) throw new Error(gradedItems.error.message);
    if (usage.error) throw new Error(usage.error.message);
    const [correct, wrong, blank] = gradedItems.data;
    console.info(
      `\nGraded: score ${graded.data.score}, ${gradedItems.data
        .map((item) => `${item.points_awarded ?? "failed"}/${item.points}`)
        .join(", ")}`,
    );

    const chat = { chatId: randomUUID(), courseId };
    const reply = await sendMessage(
      client,
      studentId,
      { ...chat, mode: "results", mockId },
      OPENING,
    );
    console.info(`Tutor: ${reply.text}`);
    const text = reply.text;

    return [
      result(
        "the mock is graded",
        graded.data.status === "graded",
        `${graded.data.status}, score ${graded.data.score}`,
      ),
      result(
        "the blank task scores 0 without a call",
        blank?.points_awarded === 0 && usage.data.length === 2,
        `${blank?.points_awarded} points; ${usage.data.length} grade_exam calls (2 expected)`,
      ),
      result(
        "the wrong final value scores less than full",
        wrong?.points_awarded != null && wrong.points_awarded < wrong.points,
        `${wrong?.points_awarded} of ${wrong?.points}`,
      ),
      result(
        "the correct answer scores at least half",
        correct?.points_awarded != null &&
          correct.points_awarded >= correct.points / 2,
        `${correct?.points_awarded} of ${correct?.points}`,
      ),
      result(
        "the Results reply starts on the biggest loss",
        /7\.1|brayton|thermal efficiency|pressure ratio/i.test(text),
        text.slice(0, 120),
      ),
      result(
        "the reply asks for the approach",
        text.includes("?"),
        text.slice(-120),
      ),
      result(
        "the reply does not give the key's final value",
        !/17[.,]?5|17[ ,]?500/.test(text),
      ),
    ];
  },
};
