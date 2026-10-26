import { randomUUID } from "node:crypto";
import { assembleMock } from "@/features/study/server";
import { signInAsUser } from "@/lib/supabase/admin";
import type { AdminSupabase } from "@/lib/supabase/types";
import { insertGoldMap, insertGoldTopics } from "./gold-map";
import { result, type SmokeCheck } from "./smoke-check";

/** The gold Big idea whose Topic loses its Exercises. */
const BARE_BIG_IDEA = "BI1";

async function insertRows(
  supabase: AdminSupabase,
  table: string,
  rows: object[],
) {
  const { error } = await supabase.from(table as "kcs").insert(rows as never);
  if (error) throw new Error(`${table}: ${error.message}`);
}

/**
 * The jet-engines gold map and Topics without model calls, with the
 * Exercises of the thrust Topic removed and an exam in 21 days. The real
 * `assembleMock` runs in process on a mock queued as the Student: the
 * thrust slot is a gap, so it generates at most 6 Problems (one `generate`
 * call each, two with the retry), and the mock must be ready.
 */
export const mockSmoke: SmokeCheck = {
  name: "mock",
  usage:
    "pnpm smoke mock (the gold map without the thrust Topic's Exercises, then one mock assembly)",
  maxCalls: 8,
  async run({ supabase, studentId }) {
    const { data: course, error } = await supabase
      .from("courses")
      .insert({ owner: studentId, name: "Smoke check" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const owned = { owner: studentId, course_id: course.id };
    const goldMap = await insertGoldMap(supabase, studentId, course.id);
    const { gold, id } = goldMap;

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
    const bareKcs = new Set(
      gold.kcs.filter((kc) => kc.bigIdea === BARE_BIG_IDEA).map((kc) => kc.id),
    );
    const kept = gold.exercises.filter(
      (exercise) => !exercise.kcs.some((kc) => bareKcs.has(kc)),
    );
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
      "A jet engine accelerates air rearward, and the reaction pushes the engine forward. Thrust is the mass flow times the change in velocity: $F = \\dot m (v_e - v_0)$.",
    );
    const questions = kept.map((exercise, index) =>
      chunk(
        index + 1,
        "exercise",
        `${exercise.name}: ${exercise.taskType}. Use the data given in the lecture.`,
      ),
    );
    await insertRows(supabase, "chunks", [source, ...questions]);
    await insertRows(
      supabase,
      "kc_sources",
      gold.kcs
        .filter((kc) => kc.bigIdea !== null)
        .map((kc) => ({ ...owned, kc_id: id(kc.id), chunk_id: source.id })),
    );
    const exerciseIds = kept.map(() => randomUUID());
    await insertRows(
      supabase,
      "exercises",
      kept.map((exercise, position) => ({
        ...owned,
        id: exerciseIds[position],
        name: exercise.name,
        task_type: exercise.taskType,
        difficulty: exercise.difficulty,
        solution_status: exercise.solutionStatus,
        solution: null,
        question_chunk_id: questions[position]!.id,
        final_answers: null,
        position,
      })),
    );
    await insertRows(
      supabase,
      "exercise_kcs",
      kept.flatMap((exercise, position) =>
        exercise.kcs.map((kc) => ({
          ...owned,
          exercise_id: exerciseIds[position],
          kc_id: id(kc),
        })),
      ),
    );
    const topicIds = await insertGoldTopics(
      supabase,
      studentId,
      course.id,
      goldMap,
    );
    const bareTopic = topicIds.get(BARE_BIG_IDEA)!;

    const exam = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
    const brief = await supabase
      .from("briefs")
      .update({
        exam_date: exam.toISOString().slice(0, 10),
        goal: "good_grade",
        hours_per_week: 6,
        question_style: "written",
        open_book: false,
        formula_sheet: false,
        calculator: true,
        scope_confirmed: true,
      })
      .eq("course_id", course.id);
    if (brief.error) throw new Error(brief.error.message);

    const client = await signInAsUser(supabase, studentId);
    const queued = await client.rpc("queue_mock_exam", {
      p_course_id: course.id,
    });
    const mockId = queued.data?.[0]?.mock_id;
    if (queued.error || !mockId) {
      throw new Error(`queue_mock_exam: ${queued.error?.message ?? "no mock"}`);
    }
    await assembleMock(mockId);

    const [mock, items, problems] = await Promise.all([
      supabase
        .from("mock_exams")
        .select("status, failure, duration_minutes, gaps_total, gaps_done")
        .eq("id", mockId)
        .single(),
      supabase
        .from("mock_items")
        .select("position, prompt, points, topic_id, problem_id")
        .eq("mock_id", mockId)
        .order("position"),
      supabase
        .from("problems")
        .select("id, status, topic_id, statement, failure")
        .eq("course_id", course.id),
    ]);
    if (mock.error) throw new Error(mock.error.message);
    if (items.error) throw new Error(items.error.message);
    if (problems.error) throw new Error(problems.error.message);
    for (const item of items.data) {
      console.info(`\nTask ${item.position + 1} (${item.points} points)`);
      console.info(item.prompt);
    }

    const generated = items.data.filter((item) => item.problem_id !== null);
    const onBareTopic = generated.filter((item) => item.topic_id === bareTopic);
    const total = items.data.reduce((sum, item) => sum + item.points, 0);
    return [
      result(
        "the mock is ready",
        mock.data.status === "ready",
        `${mock.data.status}${mock.data.failure ? `: ${mock.data.failure}` : ""}`,
      ),
      result(
        "the thrust Topic's slot has a generated Problem",
        onBareTopic.length > 0 &&
          problems.data.some(
            (p) =>
              p.topic_id === bareTopic &&
              p.status === "ready" &&
              onBareTopic.some((item) => item.problem_id === p.id),
          ),
        `${onBareTopic.length} item(s); ${problems.data
          .map((p) => `${p.status}${p.failure ? ` (${p.failure})` : ""}`)
          .join(", ")}`,
      ),
      result(
        "the duration equals the items' minutes",
        mock.data.duration_minutes === total,
        `${mock.data.duration_minutes} vs ${total}`,
      ),
      result(
        "every gap is done",
        mock.data.gaps_done === mock.data.gaps_total,
        `${mock.data.gaps_done} of ${mock.data.gaps_total}`,
      ),
    ];
  },
};
