import { updatePriorities } from "@/features/priorities/server";
import { insertGoldMap } from "./gold-map";
import { result, type SmokeCheck } from "./smoke-check";

const NOTES =
  "The lecturer stressed propulsive efficiency. Ramjets are not examined this year.";

/**
 * Inserts the jet-engines gold map and a Brief whose notes stress
 * propulsive efficiency and drop ramjets, without model calls, then runs
 * the real `updatePriorities`, whose one call adjusts the multipliers.
 */
export const prioritySmoke: SmokeCheck = {
  name: "priority",
  usage: `pnpm smoke priority (the jet-engines gold map and a Brief with notes, then one priority run)`,
  // One adjustment call, with slack for a retry.
  maxCalls: 2,
  async run({ supabase, studentId }) {
    const { data: course, error } = await supabase
      .from("courses")
      .insert({ owner: studentId, name: "Smoke check" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const owned = { owner: studentId, course_id: course.id };
    const { gold, id } = await insertGoldMap(supabase, studentId, course.id);
    const briefs = await supabase.from("briefs").insert({
      ...owned,
      notes: NOTES,
      notes_updated_at: new Date().toISOString(),
    });
    if (briefs.error) throw new Error(`briefs: ${briefs.error.message}`);
    const runs = await supabase
      .from("priority_runs")
      .insert({ ...owned, status: "running" });
    if (runs.error) throw new Error(`priority_runs: ${runs.error.message}`);

    await updatePriorities(course.id);

    const [run, stored] = await Promise.all([
      supabase
        .from("priority_runs")
        .select("status, failure_reason, adjustments")
        .eq("course_id", course.id)
        .single(),
      supabase
        .from("kc_priorities")
        .select("kc_id, priority, multiplier, reasons")
        .eq("course_id", course.id),
    ]);
    if (run.error) throw new Error(run.error.message);
    if (stored.error) throw new Error(stored.error.message);
    console.info(`Adjustment: ${JSON.stringify(run.data.adjustments)}`);
    const byKc = new Map(stored.data.map((row) => [row.kc_id, row]));
    const named = (pattern: RegExp) =>
      gold.kcs
        .filter((kc) => pattern.test(kc.name))
        .map((kc) => ({ name: kc.name, row: byKc.get(id(kc.id)) }));
    const efficiency = named(/propulsive efficiency/i);
    const ramjet = named(/^ramjet$/i)[0];
    const show = (kcs: typeof efficiency) =>
      kcs
        .map(
          ({ name, row }) =>
            `${name} ×${row?.multiplier} ${JSON.stringify(row?.reasons)}`,
        )
        .join("; ");

    return [
      result(
        "the run is done",
        run.data.status === "done",
        run.data.failure_reason ?? run.data.status,
      ),
      result(
        "every KC has a priority",
        gold.kcs.every((kc) => byKc.has(id(kc.id))),
        `${stored.data.length} of ${gold.kcs.length}`,
      ),
      result(
        "a propulsive-efficiency KC gets a multiplier above 1",
        efficiency.some(({ row }) => Number(row?.multiplier) > 1),
        show(efficiency),
      ),
      result(
        "the Ramjet KC gets 0, with a reason",
        ramjet !== undefined &&
          Number(ramjet.row?.priority) === 0 &&
          Number(ramjet.row?.multiplier) === 0 &&
          (ramjet.row?.reasons.length ?? 0) > 0,
        ramjet && show([ramjet]),
      ),
    ];
  },
};
