import { randomUUID } from "node:crypto";
import { closeStudySession } from "@/features/study/server";
import { insertRows, seedGoldCourse } from "./gold-course";
import { result, type SmokeCheck } from "./smoke-check";

/** A Memory of about 3,100 characters of dated filler lines. */
function longMemory(): string {
  const lines: string[] = [];
  for (let day = 1; lines.join("\n").length < 1_500; day++) {
    lines.push(
      `2026-09-${String(day).padStart(2, "0")}: Studied in the evening after work, prefers short sessions of about 30 minutes with a break.`,
    );
  }
  for (let day = 1; lines.join("\n").length < 3_100; day++) {
    lines.push(
      `2026-10-${String(day).padStart(2, "0")}: Asked for the formula first and the derivation afterwards; likes worked numbers.`,
    );
  }
  return lines.join("\n");
}

/** The longest Topic note the close call may write. */
const MAX_TOPIC_NOTE_LENGTH = 1_500;

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
 * The gold course with a short ended session (six messages, one Question
 * on two KCs of the first Topic, graded wrong) and a Memory of about 3,100
 * characters. The real `closeStudySession` runs in process once (one model
 * call). Checks that the session is closed, that it wrote a Topic note for
 * the touched Topic only, and that its Memory is condensed.
 */
export const closeSmoke: SmokeCheck = {
  name: "close",
  usage:
    "pnpm smoke close (the gold course with an ended session and a Memory over 3,000 characters, closed once)",
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
      .update({ started_at: started, ended_at: ended })
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

    const [closed, stored, usage, topicNotes] = await Promise.all([
      supabase
        .from("study_sessions")
        .select("closed_at")
        .eq("id", sessionId)
        .single(),
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
      supabase
        .from("topic_notes")
        .select("topic_id, text")
        .eq("owner", studentId),
    ]);
    if (topicNotes.error) throw new Error(topicNotes.error.message);
    if (closed.error) throw new Error(closed.error.message);
    if (stored.error) throw new Error(stored.error.message);
    if (usage.error) throw new Error(usage.error.message);

    console.info(
      `\nMemory: ${memory.length} -> ${stored.data.text.length} characters\n${stored.data.text}`,
    );
    const note = topicNotes.data.find(({ topic_id }) => topic_id === topic.id);
    console.info(`Topic note: ${note?.text ?? "none"}`);
    return [
      result("one close call", usage.data.length === 1, `${usage.data.length}`),
      result(
        "a Topic note for the touched Topic",
        note !== undefined &&
          note.text.length > 0 &&
          note.text.length <= MAX_TOPIC_NOTE_LENGTH,
        note ? `${note.text.length} characters` : "none",
      ),
      result(
        "no Topic note for a Topic the session did not touch",
        topicNotes.data.every(({ topic_id }) => topic_id === topic.id),
        `${topicNotes.data.length} notes`,
      ),
      result(
        "the session is closed",
        closed.data.closed_at !== null,
        `${closed.data.closed_at}`,
      ),
      result(
        "the Memory is condensed",
        stored.data.text.length > 0 &&
          stored.data.text.length < memory.length * 0.75,
        `${stored.data.text.length} characters`,
      ),
    ];
  },
};
