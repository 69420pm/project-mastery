import { randomUUID } from "node:crypto";
import { closeStudySession, pinnedLines } from "@/features/study/server";
import { result, type SmokeCheck } from "./smoke-check";
import { insertGoldCourse, insertRows } from "./tutor";

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

const MESSAGES = [
  ["user", "Let's start studying."],
  [
    "assistant",
    "Today is Thrust from momentum. Question: why does a jet engine produce thrust?",
  ],
  [
    "user",
    "Because the hot exhaust pushes against the still air behind the engine.",
  ],
  [
    "assistant",
    "Not quite: the engine pushes air backwards and, by Newton's third law, the air pushes the engine forwards. Thrust is the change in the air's momentum per second. Try again.",
  ],
  [
    "user",
    "Ok, so thrust is mass flow times the change in velocity, F = m (Ve - V0). I prefer to see a worked number first.",
  ],
  [
    "assistant",
    "Yes. With 50 kg/s, Ve = 600 m/s and V0 = 200 m/s that is 20 kN.",
  ],
] as const;

/**
 * The gold Course with a short ended learn session on its first Topic (six
 * messages, one graded Question with two KCs) and a Memory of about 3,100
 * characters with two pinned lines. The real `closeStudySession` runs in
 * process once (one model call). Checks that the session has a two-line
 * note, that the Topic has a note of at most 1,500 characters and that
 * every pinned line is still in the Memory.
 */
export const closeSmoke: SmokeCheck = {
  name: "close",
  usage:
    "pnpm smoke close (the gold Course with an ended learn session and a Memory over 3,000 characters with two pinned lines, closed once)",
  // The spec's budget: the one close call.
  maxCalls: 1,
  async run({ supabase, studentId }) {
    const { courseId, id } = await insertGoldCourse(supabase, studentId);
    const topics = await supabase
      .from("topics")
      .select("id, name")
      .eq("course_id", courseId)
      .order("position")
      .limit(1);
    if (topics.error || !topics.data[0]) {
      throw new Error(`The gold Course has no Topic: ${topics.error?.message}`);
    }
    const topic = topics.data[0];

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
      MESSAGES.map(([role, text], index) => ({
        chat_id: chatId,
        role,
        model_id: role === "assistant" ? "mock" : null,
        parts: [{ type: "text", text }],
        created_at: new Date(
          Date.parse(started) + index * 60_000,
        ).toISOString(),
      })),
    );

    const kcs = ["KC05", "KC06"];
    const questionId = randomUUID();
    await insertRows(supabase, "questions", [
      {
        id: questionId,
        owner: studentId,
        session_id: sessionId,
        kind: "question",
        prompt: "Why does a jet engine produce thrust?",
        asked_at: started,
        answer_text:
          "Because the hot exhaust pushes against the still air behind the engine.",
        answered_at: started,
        graded_at: started,
      },
    ]);
    await insertRows(
      supabase,
      "question_kcs",
      kcs.map((kc) => ({ question_id: questionId, kc_id: id(kc) })),
    );
    await insertRows(
      supabase,
      "attempts",
      kcs.map((kc) => ({
        owner: studentId,
        question_id: questionId,
        session_id: sessionId,
        kc_id: id(kc),
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
