import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { AdminSupabase } from "@/lib/supabase/types";

const GOLD_FILE = "evals/gold/jet-engines/gold.json";

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
  exercises: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      taskType: z.string(),
      solutionStatus: z.string(),
      difficulty: z.number(),
      kcs: z.array(z.string()),
    }),
  ),
});

async function insert(supabase: AdminSupabase, table: string, rows: object[]) {
  const { error } = await supabase.from(table as "kcs").insert(rows as never);
  if (error) throw new Error(`${table}: ${error.message}`);
}

/**
 * Inserts the jet-engines gold map of `GOLD_FILE` into a Course, without
 * model calls, as a built map. Returns the gold data and the stored id of
 * each gold id.
 */
export async function insertGoldMap(
  supabase: AdminSupabase,
  studentId: string,
  courseId: string,
) {
  const gold = goldSchema.parse(JSON.parse(await readFile(GOLD_FILE, "utf8")));
  const owned = { owner: studentId, course_id: courseId };
  const ids = new Map(
    [...gold.bigIdeas, ...gold.kcs].map(({ id }) => [id, randomUUID()]),
  );
  const id = (goldId: string) => ids.get(goldId) as string;

  await insert(
    supabase,
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
    supabase,
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
    supabase,
    "prerequisite_links",
    gold.prerequisites.map((link) => ({
      ...owned,
      from_kc: id(link.from),
      to_kc: id(link.to),
      extraction_confidence: link.extractionConfidence,
    })),
  );
  await insert(supabase, "knowledge_map_builds", [
    { ...owned, status: "built", finished_at: new Date().toISOString() },
  ]);
  return { gold, id };
}
