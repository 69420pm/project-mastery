import { updatePriorities } from "@/features/priorities/server";
import { seedGoldCourse } from "./gold-course";
import { result, type SmokeCheck } from "./smoke-check";

/**
 * Seeds the gold course with Brief notes that stress a KC of its first Big
 * idea and drop its last Big idea, without model calls, then runs the real
 * `updatePriorities`, whose one call adjusts the multipliers.
 */
export const prioritySmoke: SmokeCheck = {
  name: "priority",
  usage: `pnpm smoke priority (the gold course and a Brief with notes, then one priority run)`,
  // One adjustment call, with slack for a retry.
  maxCalls: 2,
  async run({ supabase, studentId }) {
    const gold = await seedGoldCourse(supabase, studentId);
    const { courseId } = gold;
    const owned = { owner: studentId, course_id: courseId };
    const stressed = gold.kcs.find(
      (kc) => kc.bigIdeaId === gold.bigIdeas[0]?.id,
    );
    const dropped = gold.bigIdeas.at(-1);
    if (!stressed || !dropped || dropped.id === gold.bigIdeas[0]?.id) {
      throw new Error("The gold course needs 2 Big ideas.");
    }
    const notes = `The lecturer stressed ${stressed.name}. ${dropped.name} is not examined this year.`;
    const briefs = await supabase
      .from("briefs")
      .update({ notes, notes_updated_at: new Date().toISOString() })
      .eq("course_id", courseId);
    if (briefs.error) throw new Error(`briefs: ${briefs.error.message}`);
    // The snapshot's run is done; this one is the Brief's.
    const cleared = await supabase
      .from("priority_runs")
      .delete()
      .eq("course_id", courseId);
    if (cleared.error) throw new Error(cleared.error.message);
    const runs = await supabase
      .from("priority_runs")
      .insert({ ...owned, status: "running" });
    if (runs.error) throw new Error(`priority_runs: ${runs.error.message}`);

    await updatePriorities(courseId);

    const [run, stored] = await Promise.all([
      supabase
        .from("priority_runs")
        .select("status, failure_reason, adjustments")
        .eq("course_id", courseId)
        .single(),
      supabase
        .from("kc_priorities")
        .select("kc_id, priority, multiplier, reasons")
        .eq("course_id", courseId),
    ]);
    if (run.error) throw new Error(run.error.message);
    if (stored.error) throw new Error(stored.error.message);
    console.info(`Notes: ${notes}`);
    console.info(`Adjustment: ${JSON.stringify(run.data.adjustments)}`);
    const byKc = new Map(stored.data.map((row) => [row.kc_id, row]));
    const show = (kcs: typeof gold.kcs) =>
      kcs
        .map((kc) => {
          const row = byKc.get(kc.id);
          return `${kc.name} ×${row?.multiplier} ${JSON.stringify(row?.reasons)}`;
        })
        .join("; ");
    const droppedKcs = gold.kcs.filter((kc) => kc.bigIdeaId === dropped.id);
    const zeroed = droppedKcs.filter((kc) => {
      const row = byKc.get(kc.id);
      return (
        Number(row?.priority) === 0 &&
        Number(row?.multiplier) === 0 &&
        (row?.reasons.length ?? 0) > 0
      );
    });

    return [
      result(
        "the run is done",
        run.data.status === "done",
        run.data.failure_reason ?? run.data.status,
      ),
      result(
        "every KC has a priority",
        gold.kcs.every((kc) => byKc.has(kc.id)),
        `${stored.data.length} of ${gold.kcs.length}`,
      ),
      result(
        `${stressed.name} gets a multiplier above 1`,
        Number(byKc.get(stressed.id)?.multiplier) > 1,
        show([stressed]),
      ),
      result(
        `a KC of ${dropped.name} gets 0, with a reason`,
        zeroed.length > 0,
        show(droppedKcs.slice(0, 3)),
      ),
    ];
  },
};
