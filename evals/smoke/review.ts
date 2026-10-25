import { randomUUID } from "node:crypto";
import { startTutoring } from "@/features/study/server";
import { signInAsUser } from "@/lib/supabase/admin";
import type { AdminSupabase } from "@/lib/supabase/types";
import { result, type SmokeCheck } from "./smoke-check";
import { insertGoldCourse, insertRows, sendMessage } from "./tutor";

const GREETING = "Let's start studying.";

/** A wrong answer to whatever the first card asks. */
const WRONG =
  "I think the hot exhaust pushes against the still air behind the engine, like a hand pushing off a wall, and that is what moves the plane.";

/** A plausible answer on the due KCs of both Topics. */
const RIGHT =
  "By Newton's third law the engine pushes air backwards and the air pushes the engine forwards: thrust is the net force from the change in the air's momentum, F = mdot_e v_e - mdot_0 v_0 + (p_e - p_0) A_e. A propeller accelerates a lot of air a little with blades outside the engine; a jet accelerates less air a lot. The turbojet's sections in flow order are the intake, the compressor, the combustion chamber, the turbine and the nozzle. The inlet slows and diffuses the incoming air so it reaches the compressor evenly, and the compressor raises the air's pressure before the fuel burns.";

/** Taught long enough ago to be due, and too recently to be. */
const DUE_DAYS_AGO = 10;
const RECENT_HOURS_AGO = 2;

/** Due: 4 KCs of Thrust from momentum and 2 of Turbojet anatomy. */
const DUE = ["KC01", "KC02", "KC03", "KC04", "KC09", "KC10"];
/** Taught but not due, so Thrust from momentum is learned for practice. */
const RECENT = ["KC05", "KC06", "KC07", "KC08"];

/** An ended learn session that taught `kcIds` at `at`, each graded full. */
async function insertTaught(
  supabase: AdminSupabase,
  studentId: string,
  courseId: string,
  kcIds: string[],
  at: string,
) {
  const session = randomUUID();
  await insertRows(supabase, "study_sessions", [
    {
      id: session,
      owner: studentId,
      course_id: courseId,
      mode: "learn",
      started_at: at,
      ended_at: at,
    },
  ]);
  const question = randomUUID();
  await insertRows(supabase, "questions", [
    {
      id: question,
      owner: studentId,
      session_id: session,
      kind: "question",
      prompt: "Explain these.",
      asked_at: at,
      answer_text: RIGHT,
      answered_at: at,
      graded_at: at,
    },
  ]);
  await insertRows(
    supabase,
    "question_kcs",
    kcIds.map((kcId) => ({ question_id: question, kc_id: kcId })),
  );
  await insertRows(
    supabase,
    "attempts",
    kcIds.map((kcId) => ({
      owner: studentId,
      question_id: question,
      session_id: session,
      kc_id: kcId,
      kind: "learn",
      result: "full",
      help: "none",
      created_at: at,
    })),
  );
}

/** The Study session of `chatId`, with its questions. */
async function chatSession(supabase: AdminSupabase, chatId: string) {
  const { data, error } = await supabase
    .from("study_sessions")
    .select("mode, questions(exercise_id, problem_id)")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

/**
 * Sets up the gold Course (`insertGoldCourse`) with 6 KCs in 2 Topics
 * taught 10 days ago, so they are due, and the rest of Thrust from momentum
 * taught 2 hours ago, so that Topic is learned. In a review Chat, through
 * the real Chat handler, it greets, answers the first card wrong and
 * answers the next two; in a practice Chat it greets once. Checks that each
 * `ask` tests a group of the review queue, that `grade` uses real question
 * ids, that a KC of the wrong answer is asked again later and that practice
 * poses a Problem through `ask` with a `problemId`.
 */
export const reviewSmoke: SmokeCheck = {
  name: "review",
  usage:
    "pnpm smoke review (the gold map with 6 due KCs in 2 Topics; a review Chat: a greeting, a wrong answer, two answers; a practice Chat: a greeting)",
  async run({ supabase, studentId }) {
    const { courseId, id, exerciseIds } = await insertGoldCourse(
      supabase,
      studentId,
    );
    await insertTaught(
      supabase,
      studentId,
      courseId,
      DUE.map(id),
      hoursAgo(DUE_DAYS_AGO * 24),
    );
    await insertTaught(
      supabase,
      studentId,
      courseId,
      RECENT.map(id),
      hoursAgo(RECENT_HOURS_AGO),
    );

    const client = await signInAsUser(supabase, studentId);
    const chat = { chatId: randomUUID(), courseId, mode: "review" as const };
    const greeting = await sendMessage(client, studentId, chat, GREETING);
    const queue =
      (await startTutoring(client, courseId, chat.chatId)).context
        .reviewQueue ?? [];
    console.info(
      `Review queue: ${queue.map((g) => g.kcs.map((kc) => kc.name).join(" + ")).join(" | ")}`,
    );
    const replies = [greeting];
    for (const text of [WRONG, RIGHT, RIGHT]) {
      const asked = replies.at(-1)!.questionIds.at(-1);
      replies.push(
        await sendMessage(client, studentId, chat, text, {
          questionId: asked,
        }),
      );
    }

    const practiceChat = {
      chatId: randomUUID(),
      courseId,
      mode: "practice" as const,
    };
    const practice = await sendMessage(
      client,
      studentId,
      practiceChat,
      GREETING,
    );

    // Each ask: a group's KCs the first time, a subset of those asked before
    // for a retry.
    const groups = queue.map((g) => g.kcs.map((kc) => kc.id));
    const asks = replies.flatMap((reply) =>
      reply.calls.filter((call) => call.toolName === "ask"),
    );
    const seen = new Set<string>();
    const offGroup = asks.filter(({ kcIds }) => {
      const retry = kcIds.length > 0 && kcIds.every((kc) => seen.has(kc));
      for (const kc of kcIds) seen.add(kc);
      const group = groups.some(
        (g) => g.length === kcIds.length && g.every((kc) => kcIds.includes(kc)),
      );
      return !(retry || group);
    });

    // Every grade names a question an ask of the Chat returned before it.
    const asked = new Set<string>();
    const badGrades: string[] = [];
    for (const reply of replies) {
      for (const call of reply.calls) {
        if (call.toolName !== "grade") continue;
        const questionId = String(call.input.questionId ?? "");
        if (!asked.has(questionId)) badGrades.push(questionId);
      }
      for (const questionId of reply.questionIds) asked.add(questionId);
    }

    // The first card's KCs graded below full, and the asks after its answer.
    const firstQuestion = greeting.questionIds.at(-1);
    const { data: missed, error } = await supabase
      .from("attempts")
      .select("kc_id, result")
      .eq("question_id", firstQuestion ?? randomUUID())
      .neq("result", "full");
    if (error) throw new Error(error.message);
    const later = replies
      .slice(1)
      .flatMap((reply) => reply.calls.filter((c) => c.toolName === "ask"));
    const retried = (missed ?? []).filter(({ kc_id }) =>
      later.some(({ kcIds }) => kcIds.includes(kc_id)),
    );

    const posed = practice.calls.find(
      (call) => call.toolName === "ask" && call.input.problemId,
    );
    const reviewSession = await chatSession(supabase, chat.chatId);
    const practiceSession = await chatSession(supabase, practiceChat.chatId);
    const withProblem = (practiceSession?.questions ?? []).filter(
      (q) =>
        exerciseIds.some((exerciseId) => exerciseId === q.exercise_id) ||
        q.problem_id !== null,
    );

    const describe = (calls: Array<{ toolName: string; kcIds: string[] }>) =>
      calls.map((c) => `${c.toolName} ×${c.kcIds.length}`).join(", ") ||
      "no tool call";
    return [
      result(
        "both Chats' sessions were stored in their mode",
        reviewSession?.mode === "review" &&
          practiceSession?.mode === "practice",
        `${reviewSession?.mode ?? "none"}, ${practiceSession?.mode ?? "none"}`,
      ),
      result(
        "the review queue holds the due KCs in at least 2 groups",
        groups.flat().length === DUE.length && groups.length >= 2,
        `${groups.length} groups of ${groups.flat().length} KCs`,
      ),
      result(
        "each ask tests a group's KCs, or retries KCs asked before",
        asks.length >= 3 && offGroup.length === 0,
        `${asks.length} asks${offGroup.length ? `; off: ${offGroup.map((a) => a.kcIds.length).join(", ")} KCs` : ""}`,
      ),
      result(
        "grade uses question ids that ask returned",
        badGrades.length === 0 &&
          replies
            .slice(1)
            .every((r) => r.calls.some((c) => c.toolName === "grade")),
        badGrades.join(", ") ||
          replies.map((r) => describe(r.calls)).join(" | "),
      ),
      result(
        "a KC of the wrong answer is asked again later",
        retried.length > 0,
        `${missed?.length ?? 0} KCs below full; later asks: ${later.map((a) => a.kcIds.length).join(", ")}`,
      ),
      result(
        "practice poses a Problem through ask with a problemId",
        posed !== undefined && withProblem.length > 0,
        describe(practice.calls),
      ),
    ];
  },
};
