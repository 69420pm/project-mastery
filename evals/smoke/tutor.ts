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

/** The gold Exercise the Student asks for, with real data and a key. */
const THRUST_EXERCISE = {
  name: "Ex. 7.2a",
  markdown:
    "Ex. 7.2a: A turbojet flies at 250 m/s and takes in 50 kg/s of air, which leaves the fully expanded nozzle at 600 m/s. Neglect the fuel's mass flow. Compute the thrust.",
  finalAnswers: [{ label: "Thrust", value: 17.5, unit: "kN" }],
  /**
   * Every KC of the gold map's thrust big idea, not only its two, so
   * `findExercises` finds it whichever of them the AI looks up: the AI knows
   * only the ids of the candidates and their anchors, which may leave out
   * the Exercise's own KCs.
   */
  kcs: ["KC01", "KC02", "KC03", "KC04", "KC05", "KC06", "KC07", "KC08"],
};

const EXERCISE_REQUEST = `Can you give me ${THRUST_EXERCISE.name} from the exercise sheet? I want to practise computing net thrust.`;

/** The right answer to `THRUST_EXERCISE`, in another unit than its key. */
const EXERCISE_ANSWER =
  "F = mdot (v_e - v_0) = 50 kg/s × (600 - 250) m/s = 17500 N.";

/** How long ago the due KCs were taught. */
const TAUGHT_DAYS_AGO = 3;

/** The tools the AI may call, which the Student must never see named. */
const TOOL_NAMES = ["readKcs", "findExercises", "remember", "ask", "grade"];

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
  /** The question it answers on its task card. */
  questionId?: string,
): Promise<{ calls: ToolCall[]; text: string; questionIds: string[] }> {
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
          ...(questionId && { metadata: { questionId } }),
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
  for (const part of chunks) {
    if (
      part.type === "tool-output-available" &&
      typeof part.output?.questionId === "string"
    ) {
      questionIds.push(part.output.questionId);
    }
    if (
      part.type === "tool-output-available" &&
      Array.isArray(part.output?.exercises)
    ) {
      const names = part.output.exercises.map(
        (exercise: { name?: string }) => exercise.name,
      );
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
  return { calls, text: reply, questionIds };
}

/**
 * Sets up a Course with the jet-engines gold map, a stand-in source chunk
 * for every KC, the gold Exercises with stand-in question chunks (Ex. 7.2a
 * with real data and a numeric key) and two KCs taught a few days ago, so
 * both are due. Then sends "Let's start studying.", a plausible answer and a
 * learning preference in a new Chat, and a request for Ex. 7.2a and its
 * right answer in a second one, through the real Chat handler, and checks
 * what the AI did, said, remembered and graded, numeric check included.
 */
export const tutorSmoke: SmokeCheck = {
  name: "tutor",
  usage:
    "pnpm smoke tutor (the gold map with stand-in sources, Exercises and two due KCs, then a greeting, an answer, a preference, a request for Ex. 7.2a and its answer in a second Chat)",
  // The spec's budget. The check counts `ai_usage` rows, and a reply's steps
  // are recorded as one row (task `chat`), with a title per Chat the only
  // others.
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
        exercise.name === THRUST_EXERCISE.name
          ? THRUST_EXERCISE.markdown
          : `${exercise.name}: ${exercise.taskType}. Use the data given in the lecture.`,
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
        final_answers:
          exercise.name === THRUST_EXERCISE.name
            ? THRUST_EXERCISE.finalAnswers
            : null,
        position,
      })),
    );
    const thrustExerciseId =
      exerciseIds[
        gold.exercises.findIndex(({ name }) => name === THRUST_EXERCISE.name)
      ];
    await insertRows(
      supabase,
      "exercise_kcs",
      gold.exercises.flatMap((exercise, position) =>
        (exercise.name === THRUST_EXERCISE.name
          ? THRUST_EXERCISE.kcs
          : exercise.kcs
        ).map((kc) => ({
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
    const chat = { chatId: randomUUID(), courseId: course.id };
    const { context } = await startTutoring(client, course.id, chat.chatId);
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

    const first = await sendMessage(client, studentId, chat, GREETING);
    // The Student answers the question the first reply asked, on its card.
    const asked = first.questionIds.at(-1);
    const second = await sendMessage(client, studentId, chat, ANSWER, asked);
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
    // In a second Chat, without open cards, the Student asks for the numeric
    // Exercise and answers it on its card.
    const exerciseChat = { chatId: randomUUID(), courseId: course.id };
    const fourth = await sendMessage(
      client,
      studentId,
      exerciseChat,
      EXERCISE_REQUEST,
    );
    const exerciseAsked = fourth.questionIds.at(-1);
    const fifth = await sendMessage(
      client,
      studentId,
      exerciseChat,
      EXERCISE_ANSWER,
      exerciseAsked,
    );

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

    const dueReads = first.calls.filter(
      ({ toolName, kcIds }) =>
        toolName === "readKcs" && kcIds.some((kc) => due.has(kc)),
    );
    // A link's target holds ids, but the Student sees only its label.
    const shown = [first.text, second.text, third.text, fourth.text, fifth.text]
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
    // The KCs the question tests show what it was about, so a reply that
    // reads a due KC and then asks about a new one fails.
    const dueAsked = askedKcs.filter((kc) => due.has(kc));
    return [
      result(
        "the first reply asked a question on a due KC through ask",
        dueReads.length > 0 && dueAsked.length > 0,
        `${describe(first.calls)}; ${dueAsked.length} due KCs asked`,
      ),
      result(
        "the answer was stored on the question",
        graded?.answer_text === ANSWER,
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
        "the preference's turn added a line to the Memory",
        memoryAfter.startsWith(memoryBefore) &&
          newLines.some((line) =>
            turnDays.some((day) => line.startsWith(`${day}: `)),
          ),
        `${describe(third.calls)}; new: ${JSON.stringify(newLines)}`,
      ),
      result(
        `the request asked ${THRUST_EXERCISE.name} as a question`,
        exercise?.exercise_id === thrustExerciseId,
        `${describe(fourth.calls)}; exercise ${exercise?.exercise_id ?? "none"}`,
      ),
      result(
        "its right final value was checked as a match on every attempt",
        checks.length > 0 && checks.every((check) => check === "match"),
        `checks ${JSON.stringify(checks)}; ${describe(fifth.calls)}`,
      ),
      result(
        "no ids or tool names in the text",
        named.length === 0,
        named.join(", "),
      ),
    ];
  },
};
