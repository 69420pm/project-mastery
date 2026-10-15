import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { updatePriorities } from "@/features/priorities/server";
import { result, type SmokeCheck } from "./smoke-check";

const GOLD_FILE = "evals/gold/jet-engines/gold.json";

const NOTES =
  "The lecturer stressed propulsive efficiency. Ramjets are not examined this year.";

const goldSchema = z.object({
  bigIdeas: z.array(
    z.object({ id: z.string(), name: z.string(), description: z.string() }),
  ),
  kcs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      type: z.string(),
      bloom: z.string().nullable(),
      bigIdea: z.string().nullable(),
      origin: z.string(),
    }),
  ),
  prerequisites: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      extractionConfidence: z.number(),
    }),
  ),
});

/**
 * Inserts the jet-engines gold map and a Brief whose notes stress
 * propulsive efficiency and drop ramjets, without model calls, then runs
 * the real `updatePriorities`, whose one call adjusts the multipliers.
 */
export const prioritySmoke: SmokeCheck = {
  name: "priority",
  usage: `pnpm smoke priority (the gold map of ${GOLD_FILE} and a Brief with notes, then one priority run)`,
  // One adjustment call, with slack for a retry.
  maxCalls: 2,
  async run({ supabase, studentId }) {
    const gold = goldSchema.parse(
      JSON.parse(await readFile(GOLD_FILE, "utf8")),
    );
    const { data: course, error } = await supabase
      .from("courses")
      .insert({ owner: studentId, name: "Smoke check" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const owned = { owner: studentId, course_id: course.id };
    const ids = new Map(
      [...gold.bigIdeas, ...gold.kcs].map(({ id }) => [id, randomUUID()]),
    );
    const id = (goldId: string) => ids.get(goldId) as string;
    const insert = async (table: string, rows: object[]) => {
      const { error: insertError } = await supabase
        .from(table as "kcs")
        .insert(rows as never);
      if (insertError) throw new Error(`${table}: ${insertError.message}`);
    };

    await insert(
      "big_ideas",
      gold.bigIdeas.map((bigIdea, position) => ({
        ...owned,
        id: id(bigIdea.id),
        name: bigIdea.name,
        description: bigIdea.description,
        position,
      })),
    );
    await insert(
      "kcs",
      gold.kcs.map((kc, position) => ({
        ...owned,
        id: id(kc.id),
        big_idea_id: kc.bigIdea && id(kc.bigIdea),
        name: kc.name,
        description: kc.description,
        type: kc.type,
        bloom: kc.bloom,
        origin: kc.origin,
        position,
      })),
    );
    await insert(
      "prerequisite_links",
      gold.prerequisites.map((link) => ({
        ...owned,
        from_kc: id(link.from),
        to_kc: id(link.to),
        extraction_confidence: link.extractionConfidence,
      })),
    );
    await insert("knowledge_map_builds", [
      { ...owned, status: "built", finished_at: new Date().toISOString() },
    ]);
    await insert("briefs", [
      { ...owned, notes: NOTES, notes_updated_at: new Date().toISOString() },
    ]);
    await insert("priority_runs", [{ ...owned, status: "running" }]);

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
