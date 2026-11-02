import { assembleMock } from "@/features/study/server";
import { signInAsUser } from "@/lib/supabase/admin";
import { seedGoldCourse } from "./gold-course";
import { result, type SmokeCheck } from "./smoke-check";

/**
 * The gold course with the Exercises of its first Topic removed and an
 * exam in 21 days. The real `assembleMock` runs in process on a mock queued
 * as the Student: the first Topic's slot is a gap, so it generates at most
 * 6 Problems (one `generate` call each, two with the retry), and the mock
 * must be ready.
 */
export const mockSmoke: SmokeCheck = {
  name: "mock",
  usage:
    "pnpm smoke mock (the gold course without its first Topic's Exercises, then one mock assembly)",
  maxCalls: 8,
  async run({ supabase, studentId }) {
    const gold = await seedGoldCourse(supabase, studentId, 21);
    const { courseId } = gold;
    const bareTopic = gold.topics[0];
    if (!bareTopic) throw new Error("The gold course has no Topic.");
    const bare = gold.exercises
      .filter((e) => e.kcs.some((kc) => bareTopic.kcs.includes(kc)))
      .map((e) => e.id);
    const removed = await supabase.from("exercises").delete().in("id", bare);
    if (removed.error) throw new Error(removed.error.message);

    const brief = await supabase
      .from("briefs")
      .update({
        goal: "good_grade",
        hours_per_week: 6,
        question_style: "written",
        open_book: false,
        formula_sheet: false,
        calculator: true,
        scope_confirmed: true,
      })
      .eq("course_id", courseId);
    if (brief.error) throw new Error(brief.error.message);

    const client = await signInAsUser(supabase, studentId);
    const queued = await client.rpc("queue_mock_exam", {
      p_course_id: courseId,
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
        .eq("course_id", courseId),
    ]);
    if (mock.error) throw new Error(mock.error.message);
    if (items.error) throw new Error(items.error.message);
    if (problems.error) throw new Error(problems.error.message);
    for (const item of items.data) {
      console.info(`\nTask ${item.position + 1} (${item.points} points)`);
      console.info(item.prompt);
    }

    const generated = items.data.filter((item) => item.problem_id !== null);
    const onBareTopic = generated.filter(
      (item) => item.topic_id === bareTopic.id,
    );
    const total = items.data.reduce((sum, item) => sum + item.points, 0);
    return [
      result(
        "the mock is ready",
        mock.data.status === "ready",
        `${mock.data.status}${mock.data.failure ? `: ${mock.data.failure}` : ""}`,
      ),
      result(
        "the first Topic's slot has a generated Problem",
        onBareTopic.length > 0 &&
          problems.data.some(
            (p) =>
              p.topic_id === bareTopic.id &&
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
