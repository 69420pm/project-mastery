import { randomUUID } from "node:crypto";
import { respondInChat } from "@/features/chat/server";
import { startTutoring } from "@/features/study/server";
import { signInAsUser } from "@/lib/supabase/admin";
import { insertGoldMap } from "./gold-map";
import { result, type SmokeCheck } from "./smoke-check";

const MESSAGE = "Let's start studying.";

/** The tools the AI may call, which the Student must never see named. */
const TOOL_NAMES = ["readKcs", "findExercises"];

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

/**
 * Sends "Let's start studying." in a new Chat of a Course with the
 * jet-engines gold map, a stand-in source chunk for every KC and the gold
 * Exercises with stand-in question chunks, through the real Chat handler,
 * and checks what the AI did and said.
 */
export const tutorSmoke: SmokeCheck = {
  name: "tutor",
  usage:
    "pnpm smoke tutor (the gold map with stand-in sources and Exercises, then one greeting in a Chat)",
  // One call per step: reading the KCs, the Exercises and the text, with
  // slack for a retry; the title is the only other call.
  maxCalls: 5,
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

    // The Chat runs as the Student, with Row Level Security as in the app.
    const client = await signInAsUser(supabase, studentId);
    const { context } = await startTutoring(client, course.id);
    const offered = new Set(
      context.candidates.flatMap(({ kcs }) =>
        kcs.flatMap((kc) => [kc.id, ...kc.anchors.map((a) => a.id)]),
      ),
    );
    console.info(`Candidates offered: ${context.candidates.length} groups`);

    console.info(`Student: ${MESSAGE}`);
    const response = await respondInChat({
      request: new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          chatId: randomUUID(),
          courseId: course.id,
          message: {
            id: randomUUID(),
            role: "user",
            parts: [{ type: "text", text: MESSAGE }],
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

    const calls: Array<{ toolName: string; kcIds: string[] }> = [];
    for (const part of chunks) {
      if (part.type === "tool-input-available") {
        console.info(`  ${part.toolName} ${JSON.stringify(part.input)}`);
        calls.push({ toolName: part.toolName, kcIds: part.input?.kcIds ?? [] });
      }
      if (part.type === "tool-output-error" || part.type === "error") {
        console.info(`  ${part.type}: ${part.errorText}`);
      }
    }
    const text = chunks
      .filter((part) => part.type === "text-delta")
      .map((part) => part.delta)
      .join("");
    console.info(`AI: ${text}`);

    const candidateCalls = calls.filter(
      ({ kcIds }) => kcIds.length > 0 && kcIds.every((kc) => offered.has(kc)),
    );
    // A link's target holds ids, but the Student sees only its label.
    const shown = text.replace(/\]\([^)]*\)/g, "]");
    const named = [
      ...[...offered].filter((kc) => shown.includes(kc)),
      ...(UUID.test(shown) ? ["a UUID"] : []),
      ...TOOL_NAMES.filter((name) => shown.includes(name)),
    ];
    return [
      result(
        "a tool was called with candidate KC ids",
        candidateCalls.length > 0,
        calls.length === 0
          ? "no tool call"
          : calls.map((c) => `${c.toolName} ×${c.kcIds.length}`).join(", "),
      ),
      result(
        "the reply ends by asking the Student something",
        /\?[\s"'”)*_]*$/.test(text.trim()),
        JSON.stringify(text.trim().slice(-80)),
      ),
      result(
        "no ids or tool names in the text",
        named.length === 0,
        named.join(", "),
      ),
    ];
  },
};
