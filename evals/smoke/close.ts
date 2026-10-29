import { randomUUID } from "node:crypto";
import { closeStudySession, pinnedLines } from "@/features/study/server";
import { insertRows, seedGoldCourse } from "./gold-course";
import { result, type SmokeCheck } from "./smoke-check";

const PINS = [
  "!Never explain with car analogies, they confuse me.",
  "!The exam is on 12 December; keep sessions under 40 minutes.",
];

/** A Memory of about 3,100 characters: dated filler lines and two pins. */
function longMemory(): string {
  const lines = [PINS[0]!];
  for (let day = 1; lines.join("\n").length < 1_500; day++) {
    lines.push(
      `2026-09-${String(day).padStart(2, "0")}: Studied in the evening after work, prefers short sessions of about 30 minutes with a break.`,
    );
  }
  lines.push(PINS[1]!);
  for (let day = 1; lines.join("\n").length < 3_100; day++) {
    lines.push(
      `2026-10-${String(day).padStart(2, "0")}: Asked for the formula first and the derivation afterwards; likes worked numbers.`,
    );
  }
  return lines.join("\n");
}

const WRONG_ANSWER = "I'm not sure, I think it is just a name to memorise.";

/** Six messages of a short session on `topic`, built from its first KC. */
function messages(
  topic: { name: string; centralQuestion: string },
  kc: { name: string; description: string },
) {
  return [
    ["user", "Let's start studying."],
    ["assistant", `Today is ${topic.name}. Question: ${topic.centralQuestion}`],
    ["user", WRONG_ANSWER],
    ["assistant", `Not quite: ${kc.description} Try again.`],
    [
      "user",
      `Ok, so ${kc.name}: ${kc.description} I prefer to see a worked example first.`,
    ],
    ["assistant", "Yes, exactly."],
  ] as const;
}

/**
 * The gold course with a short ended learn session on its first Topic (six
 * messages, one Question on two of its KCs, graded wrong) and a Memory of
 * about 3,100 characters with two pinned lines. The real
 * `closeStudySession` runs in process once (one model call). Checks that
 * the session has a two-line note, that the Topic has a note of at most
 * 1,500 characters and that every pinned line is still in the Memory.
 */
export const closeSmoke: SmokeCheck = {
  name: "close",
  usage:
    "pnpm smoke close (the gold course with an ended learn session and a Memory over 3,000 characters with two pinned lines, closed once)",
  // The spec's budget: the one close call.
  maxCalls: 1,
  async run({ supabase, studentId }) {
    const gold = await seedGoldCourse(supabase, studentId);
    const { courseId } = gold;
    const topic = gold.topics[0];
    if (!topic) throw new Error("The gold course has no Topic.");
    const kcs = topic.kcs.slice(0, 2);
    const firstKc = gold.kcs.find((kc) => kc.id === kcs[0]);
    if (!firstKc) throw new Error("The gold course's first Topic has no KC.");

    const chatId = randomUUID();
    await insertRows(supabase, "chats", [
      { id: chatId, owner: studentId, course_id: courseId },
    ]);
    const started = new Date(Date.now() - 30 * 60_000).toISOString();
    const ended = new Date().toISOString();
    const session = await supabase
      .from("study_sessions")
      .update({ topic_id: topic.id, started_at: started, ended_at: ended })
      .eq("chat_id", chatId)
      .select("id")
      .single();
    if (session.error) throw new Error(session.error.message);
    const sessionId = session.data.id;

    await insertRows(
      supabase,
      "chat_messages",
      messages(topic, firstKc).map(([role, text], index) => ({
        chat_id: chatId,
        role,
        model_id: role === "assistant" ? "mock" : null,
        parts: [{ type: "text", text }],
        created_at: new Date(
          Date.parse(started) + index * 60_000,
        ).toISOString(),
      })),
    );

    const questionId = randomUUID();
    await insertRows(supabase, "questions", [
      {
        id: questionId,
        owner: studentId,
        session_id: sessionId,
        kind: "question",
        prompt: topic.centralQuestion,
        asked_at: started,
        answer_text: WRONG_ANSWER,
        answered_at: started,
        graded_at: started,
      },
    ]);
    await insertRows(
      supabase,
      "question_kcs",
      kcs.map((kc) => ({ question_id: questionId, kc_id: kc })),
    );
    await insertRows(
      supabase,
      "attempts",
      kcs.map((kc) => ({
        owner: studentId,
        question_id: questionId,
        session_id: sessionId,
        kc_id: kc,
        kind: "learn",
        result: "wrong",
        help: "none",
        created_at: started,
      })),
    );

    const memory = longMemory();
    await insertRows(supabase, "memories", [
      { course_id: courseId, owner: studentId, text: memory },
    ]);

    await closeStudySession(sessionId);

    const [closed, note, stored, usage] = await Promise.all([
      supabase
        .from("study_sessions")
        .select("session_note")
        .eq("id", sessionId)
        .single(),
      supabase
        .from("topic_notes")
        .select("text")
        .eq("topic_id", topic.id)
        .maybeSingle(),
      supabase
        .from("memories")
        .select("text")
        .eq("course_id", courseId)
        .single(),
      supabase
        .from("ai_usage")
        .select("id")
        .eq("owner", studentId)
        .eq("task", "close"),
    ]);
    if (closed.error) throw new Error(closed.error.message);
    if (note.error) throw new Error(note.error.message);
    if (stored.error) throw new Error(stored.error.message);
    if (usage.error) throw new Error(usage.error.message);

    const sessionNote = closed.data.session_note ?? "";
    const topicNote = note.data?.text ?? "";
    console.info(
      `\nSession note: ${sessionNote}\nTopic note: ${topicNote}\nMemory: ${memory.length} -> ${stored.data.text.length} characters`,
    );
    const lines = sessionNote.split("\n").filter((line) => line.trim() !== "");
    return [
      result("one close call", usage.data.length === 1, `${usage.data.length}`),
      result(
        "the session has a two-line note",
        lines.length === 2 && sessionNote.length <= 300,
        JSON.stringify(sessionNote),
      ),
      result(
        "the Topic has a note of at most 1,500 characters",
        topicNote.length > 0 && topicNote.length <= 1_500,
        `${topicNote.length} characters`,
      ),
      result(
        "every pinned line is still in the Memory",
        pinnedLines(memory).length === PINS.length &&
          PINS.every((pin) => stored.data.text.includes(pin)),
        `${stored.data.text.length} characters`,
      ),
    ];
  },
};
