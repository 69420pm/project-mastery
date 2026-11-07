import { randomUUID } from "node:crypto";
import { respondInChat } from "@/features/chat/server";
import type { GradedKc } from "@/features/study/server";
import { signInAsUser } from "@/lib/supabase/admin";
import type { AdminSupabase, Supabase } from "@/lib/supabase/types";
import {
  answerText,
  insertRows,
  numericExercise,
  seedGoldCourse,
} from "./gold-course";
import { result, type SmokeCheck } from "./smoke-check";

const GREETING = "Let's start studying.";

/** How long ago the due KCs were taught. */
const TAUGHT_DAYS_AGO = 3;

/** The tools the AI may call, which the Student must never see named. */
const TOOL_NAMES = [
  "getTopic",
  "findProblems",
  "remember",
  "ask",
  "showReading",
  "grade",
];

/**
 * Whether `text` names the tool as code: a camelCase name anywhere as a
 * word, and any name in backticks or called, such as `ask(`. "I'll remember
 * that" or "a task" names no tool.
 */
function namesTool(text: string, name: string): boolean {
  const asCode = new RegExp(`\`${name}\`|\\b${name}\\(`);
  return (
    asCode.test(text) ||
    (/[A-Z]/.test(name) && new RegExp(`\\b${name}\\b`).test(text))
  );
}

/** The Student's wish to read first, in a fourth Chat (#179). */
const READING_REQUEST =
  "I'd like to read the course's pages on this before we start.";

/** A preference worth keeping in the Memory (#107). */
const PREFERENCE = "I learn best with examples before formulas.";

/** The Memory of the Course, read as the admin. */
async function readMemory(
  supabase: AdminSupabase,
  courseId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("memories")
    .select("text")
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) throw new Error(`memories: ${error.message}`);
  return data?.text ?? "";
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** A tool call the AI made, with the KC ids it passed. */
type ToolCall = {
  toolName: string;
  kcIds: string[];
  input: Record<string, unknown>;
};

/**
 * Sends `text` in the Chat through the real Chat handler as the Student,
 * and returns the AI's tool calls and text.
 */
export async function sendMessage(
  client: Supabase,
  studentId: string,
  chat: { chatId: string; courseId: string },
  text: string,
): Promise<{
  calls: ToolCall[];
  text: string;
  questionIds: string[];
  graded: GradedKc[];
  /** The KC ids the tools' results named, such as an Exercise's KCs. */
  returned: string[];
  /** The `showReading` calls' inputs. */
  readings: Array<{ sectionId: string; purpose: string }>;
}> {
  console.info(`Student: ${text}`);
  const response = await respondInChat({
    request: new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        ...chat,
        message: {
          id: randomUUID(),
          role: "user",
          parts: [{ type: "text", text }],
        },
      }),
    }),
    supabase: client,
    userId: studentId,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${body}`);
  const chunks = body
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice("data: ".length)));

  const calls: ToolCall[] = [];
  const questionIds: string[] = [];
  const graded: GradedKc[] = [];
  const returned: string[] = [];
  const readings: Array<{ sectionId: string; purpose: string }> = [];
  const toolNames = new Map<string, string>();
  const callsById = new Map<string, ToolCall>();
  for (const part of chunks) {
    if (part.type === "tool-input-available") {
      toolNames.set(part.toolCallId, part.toolName);
    }
    if (
      part.type === "tool-output-available" &&
      toolNames.get(part.toolCallId) === "grade" &&
      Array.isArray(part.output?.kcs)
    ) {
      graded.push(...part.output.kcs);
      console.info(`  graded ${JSON.stringify(part.output.kcs)}`);
    }
    if (
      part.type === "tool-output-available" &&
      toolNames.get(part.toolCallId) === "getTopic" &&
      Array.isArray(part.output?.kcs)
    ) {
      // A call without kcIds read every KC of the Topic.
      const call = callsById.get(part.toolCallId);
      const read = part.output.kcs.map((kc: { id: string }) => kc.id);
      if (call && call.kcIds.length === 0) call.kcIds = read;
      returned.push(
        ...(part.output.anchors ?? []).map((kc: { id: string }) => kc.id),
      );
    }
    if (
      part.type === "tool-output-available" &&
      typeof part.output?.questionId === "string"
    ) {
      questionIds.push(part.output.questionId);
    }
    if (
      part.type === "tool-output-available" &&
      Array.isArray(part.output?.problems)
    ) {
      const names = part.output.problems.map(
        (exercise: { name?: string }) => exercise.name,
      );
      for (const exercise of part.output.problems) {
        returned.push(
          ...(exercise.kcs ?? []).map((kc: { id: string }) => kc.id),
        );
      }
      console.info(
        `  found ${JSON.stringify(names)} ${part.output.note ?? ""}`,
      );
    }
    if (part.type === "tool-input-available") {
      console.info(`  ${part.toolName} ${JSON.stringify(part.input)}`);
      const kcIds =
        part.input?.kcIds ??
        part.input?.results?.map((kc: { kcId: string }) => kc.kcId) ??
        [];
      const call = {
        toolName: part.toolName,
        kcIds,
        input: part.input ?? {},
      };
      calls.push(call);
      callsById.set(part.toolCallId, call);
      if (part.toolName === "showReading") {
        readings.push({
          sectionId: String(part.input?.sectionId ?? ""),
          purpose: String(part.input?.purpose ?? ""),
        });
      }
    }
    if (part.type === "tool-output-error" || part.type === "error") {
      console.info(`  ${part.type}: ${part.errorText}`);
    }
  }
  const reply = chunks
    .filter((part) => part.type === "text-delta")
    .map((part) => part.delta)
    .join("");
  console.info(`AI: ${reply}`);
  return { calls, text: reply, questionIds, graded, returned, readings };
}

/**
 * Seeds the gold course (`seedGoldCourse`). Sends "Let's start studying."
 * in a first Chat, where nothing is taught yet. Then teaches two KCs without Prerequisites a few days ago, so both
 * are due, and sends "Let's start studying.", their descriptions as the
 * answer and a learning preference in a new Chat; in a third one, a request
 * for an Exercise with a numeric key on the KCs the AI knows, and its key as
 * the answer; in a fourth, the wish to read the course's pages first, all
 * through the real Chat handler. Checks what the AI did, said, remembered,
 * graded and opened, numeric check included, and that every KC id it used
 * belongs to the Course or a tool's result.
 */
export const tutorSmoke: SmokeCheck = {
  name: "tutor",
  usage:
    "pnpm smoke tutor (the gold course; a greeting on the next Topic, then two due KCs, a greeting, an answer, a preference, and a request for a numeric Exercise and its answer in a third Chat; a wish to read first in a fourth)",
  // The spec's budget. The check counts `ai_usage` rows, and a reply's steps
  // are recorded as one row (task `chat`), with a title per Chat the only
  // others.
  maxCalls: 15,
  async run({ supabase, studentId }) {
    const gold = await seedGoldCourse(supabase, studentId);
    const course = { id: gold.courseId };
    const owned = { owner: studentId, course_id: gold.courseId };

    // The Chat runs as the Student, with Row Level Security as in the app.
    // Before anything is taught, a greeting starts on the next Topic.
    const client = await signInAsUser(supabase, studentId);
    const freshChat = { chatId: randomUUID(), courseId: course.id };
    const nextKcs = new Set(gold.topics[0]?.kcs);
    if (nextKcs.size === 0) throw new Error("The gold course has no Topic.");
    const opening = await sendMessage(client, studentId, freshChat, GREETING);

    // Two KCs without Prerequisites, taught a few days ago by a question
    // graded full in an earlier session. Only the admin client can backdate
    // an attempt.
    const hasPrerequisite = new Set(gold.prerequisites.map((link) => link.to));
    const taughtKcs = gold.kcs
      .filter((kc) => !hasPrerequisite.has(kc.id))
      .slice(0, 2);
    const taught = taughtKcs.map((kc) => kc.id);
    const answer = taughtKcs.map((kc) => kc.description).join(" ");
    const taughtAt = new Date(
      Date.now() - TAUGHT_DAYS_AGO * 24 * 60 * 60 * 1000,
    ).toISOString();
    const session = { id: randomUUID(), owner: studentId };
    await insertRows(supabase, "study_sessions", [
      {
        ...owned,
        ...session,
        started_at: taughtAt,
        ended_at: taughtAt,
      },
    ]);
    const question = { id: randomUUID(), owner: studentId };
    await insertRows(supabase, "questions", [
      {
        ...question,
        session_id: session.id,
        prompt: `Explain ${taughtKcs.map((kc) => kc.name).join(" and ")}.`,
        asked_at: taughtAt,
        answer_text: answer,
        answered_at: taughtAt,
        graded_at: taughtAt,
      },
    ]);
    await insertRows(
      supabase,
      "question_kcs",
      taught.map((kcId) => ({ question_id: question.id, kc_id: kcId })),
    );
    await insertRows(
      supabase,
      "attempts",
      taught.map((kcId) => ({
        owner: studentId,
        question_id: question.id,
        session_id: session.id,
        kc_id: kcId,
        result: "full",
        help: "none",
        created_at: taughtAt,
      })),
    );

    const chat = { chatId: randomUUID(), courseId: course.id };
    const due = new Set(taught);
    const offered = new Set(gold.kcs.map((kc) => kc.id));

    const first = await sendMessage(client, studentId, chat, GREETING);
    // The Student's next message answers the question the first reply asked.
    const asked = first.questionIds.at(-1);
    const second = await sendMessage(client, studentId, chat, answer);
    const memoryBefore = await readMemory(supabase, course.id);
    // The turn may cross UTC midnight, so either day counts as "this turn".
    const utcDay = () => new Date().toISOString().slice(0, 10);
    const turnDays = [utcDay()];
    const third = await sendMessage(client, studentId, chat, PREFERENCE);
    turnDays.push(utcDay());
    const memoryAfter = await readMemory(supabase, course.id);
    const newLines = memoryAfter
      .split("\n")
      .slice(memoryBefore === "" ? 0 : memoryBefore.split("\n").length);
    console.info(`Memory: ${JSON.stringify(memoryAfter)}`);
    // In another Chat the Student asks for an Exercise with a numeric key on
    // the KCs studied so far, and answers it.
    const exerciseChat = { chatId: randomUUID(), courseId: course.id };
    const target = numericExercise(gold, [...taught, ...nextKcs]);
    const fourth = await sendMessage(
      client,
      studentId,
      exerciseChat,
      `Can you give me the exercise from ${target.label}? It starts: "${target.markdown.slice(0, 120)}". I want to practise it.`,
    );
    const exerciseAsked = fourth.questionIds.at(-1);
    const fifth = await sendMessage(
      client,
      studentId,
      exerciseChat,
      `My result: ${answerText(target.finalAnswers)}.`,
    );

    // In a fourth Chat, the Student wants to read first.
    const readingChat = { chatId: randomUUID(), courseId: course.id };
    const sixth = await sendMessage(
      client,
      studentId,
      readingChat,
      READING_REQUEST,
    );
    const opened = sixth.readings.at(-1);

    // An asked question with its answer and the attempts its grade stored.
    const loadQuestion = async (questionId: string | undefined) => {
      if (!questionId) return null;
      const { data, error } = await supabase
        .from("questions")
        .select(
          'exercise_id, answer_text, graded_at, question_kcs(kc_id), attempts(kc_id, result, help, "check")',
        )
        .eq("id", questionId)
        .single();
      if (error) throw new Error(error.message);
      return data;
    };
    const graded = await loadQuestion(asked);
    const exercise = await loadQuestion(exerciseAsked);
    const checks = exercise?.attempts.map((attempt) => attempt.check) ?? [];
    console.info(`Exercise graded: ${JSON.stringify(exercise?.attempts)}`);
    const recorded = graded?.attempts ?? [];
    console.info(`Graded: ${JSON.stringify(recorded)}`);
    const askedKcs = graded?.question_kcs.map(({ kc_id }) => kc_id) ?? [];

    // A link's target holds ids, but the Student sees only its label.
    const replies = [opening, first, second, third, fourth, fifth, sixth];
    const shown = replies
      .map((reply) => reply.text)
      .join("\n")
      .replace(/\]\([^)]*\)/g, "]");
    const named = [
      ...[...offered].filter((kc) => shown.includes(kc)),
      ...(UUID.test(shown) ? ["a UUID"] : []),
      ...TOOL_NAMES.filter((name) => namesTool(shown, name)),
    ];
    const describe = (calls: ToolCall[]) =>
      calls.length === 0
        ? "no tool call"
        : calls.map((c) => `${c.toolName} ×${c.kcIds.length}`).join(", ");
    // The KCs the question tests show what it was about, so a reply that
    // reads a due KC and then asks about a new one fails.
    const dueAsked = askedKcs.filter((kc) => due.has(kc));
    // Under the per-day rule every graded KC has a card at once.
    const states = [second, fifth].flatMap(({ graded }) =>
      graded.map((kc) => kc.band !== "new" && kc.nextReview !== null),
    );
    const knownIds = new Set([
      ...offered,
      ...replies.flatMap((reply) => reply.returned),
    ]);
    const unknown = replies.flatMap(({ calls }) =>
      calls.flatMap(({ kcIds }) => kcIds.filter((kc) => !knownIds.has(kc))),
    );
    return [
      result(
        "the greeting got a reply",
        opening.text.trim() !== "" || opening.calls.length > 0,
        describe(opening.calls),
      ),
      result(
        "every KC id the AI used belongs to its context or a tool's result",
        unknown.length === 0,
        unknown.join(", "),
      ),
      result(
        "the first reply asked a question on a due KC through ask",
        dueAsked.length > 0,
        `${describe(first.calls)}; ${dueAsked.length} due KCs asked`,
      ),
      result(
        "the answer was stored on the question",
        graded?.answer_text === answer,
        asked ? "" : "no question asked",
      ),
      result(
        "the answer's turn graded it: one attempt per KC of the question",
        graded?.graded_at != null &&
          recorded.length === askedKcs.length &&
          askedKcs.every((kc) => recorded.some(({ kc_id }) => kc_id === kc)),
        `${recorded.length} attempts for ${askedKcs.length} KCs; ${describe(second.calls)}`,
      ),
      result(
        "grade gave every KC a recall band and a next review",
        states.length > 0 && states.every(Boolean),
        JSON.stringify(
          [...second.graded, ...fifth.graded].map(
            ({ id, band, nextReview }) => ({ id, band, nextReview }),
          ),
        ),
      ),
      result(
        "the preference's turn added a line to the Memory",
        memoryAfter.startsWith(memoryBefore) &&
          newLines.some((line) =>
            turnDays.some((day) => line.startsWith(`${day}: `)),
          ),
        `${describe(third.calls)}; new: ${JSON.stringify(newLines)}`,
      ),
      result(
        `the request found ${target.label} with findProblems and asked it by its problemId`,
        fourth.calls.some(({ toolName }) => toolName === "findProblems") &&
          exercise?.exercise_id === target.id,
        `${describe(fourth.calls)}; exercise ${exercise?.exercise_id ?? "none"}`,
      ),
      result(
        "its right final value was checked as a match on every attempt",
        checks.length > 0 && checks.every((check) => check === "match"),
        `checks ${JSON.stringify(checks)}; ${describe(fifth.calls)}`,
      ),
      result(
        "the wish to read opened a section with a purpose through showReading",
        opened !== undefined && opened.purpose.trim() !== "",
        `${describe(sixth.calls)}; ${JSON.stringify(opened ?? null)}`,
      ),
      result(
        "no ids or tool names in the text",
        named.length === 0,
        named.join(", "),
      ),
    ];
  },
};
