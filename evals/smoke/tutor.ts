import { randomUUID } from "node:crypto";
import { respondInChat } from "@/features/chat/server";
import { startTutoring } from "@/features/study/server";
import { signInAsUser } from "@/lib/supabase/admin";
import type { Supabase } from "@/lib/supabase/types";
import { insertGoldMap } from "./gold-map";
import { result, type SmokeCheck } from "./smoke-check";

const GREETING = "Let's start studying.";

/**
 * A plausible answer to a review question on the two due KCs: the five
 * turbojet sections and thermal efficiency, the gold map's content KCs
 * without Prerequisites.
 */
const ANSWER =
  "I think the air goes through the intake, the compressor, the combustion chamber, the turbine and then the nozzle. Thermal efficiency is the useful power you get out, the gain in the jet's kinetic energy, divided by the heat the fuel puts in.";

/** How long ago the due KCs were taught. */
const TAUGHT_DAYS_AGO = 3;

/** The tools the AI may call, which the Student must never see named. */
const TOOL_NAMES = ["readKcs", "findExercises", "remember"];

/** A preference worth keeping in the Memory (#107). */
const PREFERENCE = "I learn best with examples before formulas.";

/** The Memory of the Course, read as the admin. */
async function readMemory(
  supabase: Parameters<typeof insertGoldMap>[0],
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

/** Rows of `table` for the Student's Course, inserted as given. */
async function insertRows(
  supabase: Parameters<typeof insertGoldMap>[0],
  table: string,
  rows: object[],
) {
  const { error } = await supabase.from(table as "kcs").insert(rows as never);
  if (error) throw new Error(`${table}: ${error.message}`);
}

/** A tool call the AI made, with the KC ids it passed. */
type ToolCall = { toolName: string; kcIds: string[] };

/**
 * Sends `text` in the Chat through the real Chat handler as the Student,
 * and returns the AI's tool calls and text.
 */
async function sendMessage(
  client: Supabase,
  studentId: string,
  chat: { chatId: string; courseId: string },
  text: string,
): Promise<{ calls: ToolCall[]; text: string }> {
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
  for (const part of chunks) {
    if (part.type === "tool-input-available") {
      console.info(`  ${part.toolName} ${JSON.stringify(part.input)}`);
      const kcIds =
        part.input?.kcIds ??
        part.input?.kcs?.map((kc: { kcId: string }) => kc.kcId) ??
        [];
      calls.push({ toolName: part.toolName, kcIds });
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
  return { calls, text: reply };
}

/**
 * Sets up a Course with the jet-engines gold map, a stand-in source chunk
 * for every KC, the gold Exercises with stand-in question chunks and two
 * KCs taught a few days ago, so both are due. Then sends "Let's start
 * studying.", a plausible answer and a learning preference in a new Chat,
 * through the real Chat handler, and checks what the AI did, said and
 * remembered.
 */
export const tutorSmoke: SmokeCheck = {
  name: "tutor",
  usage:
    "pnpm smoke tutor (the gold map with stand-in sources, Exercises and two due KCs, then a greeting, an answer and a preference in a Chat)",
  // The spec's budget. The check counts `ai_usage` rows, and a reply's steps
  // are recorded as one row (task `chat`), with the title the only other.
  maxCalls: 12,
  async run({ supabase, studentId }) {
    const { data: course, error } = await supabase
      .from("courses")
      .insert({ owner: studentId, name: "Smoke check" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const owned = { owner: studentId, course_id: course.id };
    const { gold, id } = await insertGoldMap(supabase, studentId, course.id);

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
      "A jet engine accelerates air rearward, and the reaction pushes the engine forward (Newton's third law). Thrust is the mass flow times the change in velocity.",
    );
    const questions = gold.exercises.map((exercise, index) =>
      chunk(
        index + 1,
        "exercise",
        `${exercise.name}: ${exercise.taskType}. Use the data given in the lecture.`,
      ),
    );
    await insertRows(supabase, "chunks", [source, ...questions]);
    await insertRows(
      supabase,
      "knowledge_map_chunks",
      [source, ...questions].map(({ id: chunkId }) => ({
        ...owned,
        chunk_id: chunkId,
      })),
    );
    await insertRows(
      supabase,
      "kc_sources",
      gold.kcs
        .filter((kc) => kc.bigIdea !== null)
        .map((kc) => ({ ...owned, kc_id: id(kc.id), chunk_id: source.id })),
    );
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
        position,
      })),
    );
    await insertRows(
      supabase,
      "exercise_kcs",
      gold.exercises.flatMap((exercise, position) =>
        exercise.kcs.map((kc) => ({
          ...owned,
          exercise_id: exerciseIds[position],
          kc_id: id(kc),
        })),
      ),
    );

    // Two content KCs without Prerequisites, taught a few days ago by a
    // question graded full in an earlier session. Only the admin client can
    // backdate an attempt.
    const hasPrerequisite = new Set(gold.prerequisites.map((link) => link.to));
    const taught = gold.kcs
      .filter((kc) => kc.bigIdea !== null && !hasPrerequisite.has(kc.id))
      .slice(0, 2)
      .map((kc) => id(kc.id));
    const taughtAt = new Date(
      Date.now() - TAUGHT_DAYS_AGO * 24 * 60 * 60 * 1000,
    ).toISOString();
    const session = { id: randomUUID(), owner: studentId };
    await insertRows(supabase, "study_sessions", [
      { ...owned, ...session, mode: "learn", started_at: taughtAt },
    ]);
    const question = { id: randomUUID(), owner: studentId };
    await insertRows(supabase, "questions", [
      {
        ...question,
        session_id: session.id,
        kind: "question",
        prompt:
          "Name the sections of a turbojet and define thermal efficiency.",
        asked_at: taughtAt,
        answer_text: ANSWER,
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
        kind: "learn",
        result: "full",
        help: "none",
        created_at: taughtAt,
      })),
    );

    // The Chat runs as the Student, with Row Level Security as in the app.
    const client = await signInAsUser(supabase, studentId);
    const { context } = await startTutoring(client, course.id);
    const due = new Set(context.dueReviews.kcs.map((kc) => kc.id));
    const offered = new Set([
      ...due,
      ...context.candidates.flatMap(({ kcs }) =>
        kcs.flatMap((kc) => [kc.id, ...kc.anchors.map((a) => a.id)]),
      ),
    ]);
    console.info(
      `Due reviews: ${due.size}; candidates: ${context.candidates.length} groups`,
    );
    if (due.size !== taught.length) {
      throw new Error(`Expected ${taught.length} due KCs, got ${due.size}`);
    }

    const chat = { chatId: randomUUID(), courseId: course.id };
    const first = await sendMessage(client, studentId, chat, GREETING);
    const answeredAt = new Date().toISOString();
    const second = await sendMessage(client, studentId, chat, ANSWER);
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

    const { data: recorded, error: attemptsError } = await supabase
      .from("attempts")
      .select("kc_id, study_sessions!inner(course_id)")
      .eq("study_sessions.course_id", course.id)
      .gte("created_at", answeredAt);
    if (attemptsError) throw new Error(attemptsError.message);
    const courseKcs = new Set(gold.kcs.map((kc) => id(kc.id)));

    const dueReads = first.calls.filter(
      ({ toolName, kcIds }) =>
        toolName === "readKcs" && kcIds.some((kc) => due.has(kc)),
    );
    // A link's target holds ids, but the Student sees only its label.
    const shown = [first.text, second.text, third.text]
      .join("\n")
      .replace(/\]\([^)]*\)/g, "]");
    const named = [
      ...[...offered].filter((kc) => shown.includes(kc)),
      ...(UUID.test(shown) ? ["a UUID"] : []),
      ...TOOL_NAMES.filter((name) => shown.includes(name)),
    ];
    const describe = (calls: ToolCall[]) =>
      calls.length === 0
        ? "no tool call"
        : calls.map((c) => `${c.toolName} ×${c.kcIds.length}`).join(", ");
    // The KCs the answer's turn recorded show what the question was about,
    // so a reply that reads a due KC and then asks about a new one fails.
    const dueRecorded = recorded.filter(({ kc_id }) => due.has(kc_id));
    return [
      result(
        "the first reply asked about a due KC",
        dueReads.length > 0 && dueRecorded.length > 0,
        `read: ${describe(first.calls)}; ${dueRecorded.length} due KCs recorded`,
      ),
      result(
        "the first reply ends by asking the Student something",
        /\?[\s"'”)*_]*$/.test(first.text.trim()),
        JSON.stringify(first.text.trim().slice(-80)),
      ),
      result(
        "the answer's turn recorded an attempt on a Course KC",
        recorded.some(({ kc_id }) => courseKcs.has(kc_id)),
        `${recorded.length} rows; ${describe(second.calls)}`,
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
        "no ids or tool names in the text",
        named.length === 0,
        named.join(", "),
      ),
    ];
  },
};
