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
      /** Positions in `chunks.json`. */
      sources: z.array(z.number()),
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

/** A central question for each gold Big idea's Topic, by gold id. */
const CENTRAL_QUESTIONS: Record<string, string> = {
  BI1: "How does pushing air backwards move an engine forwards, and how much?",
  BI2: "What does each section of a turbojet do to the air flowing through it?",
  BI3: "How does the Brayton cycle turn fuel into work, and what limits its efficiency?",
  BI4: "Why do engines differ in how efficiently they turn jet power into thrust?",
};

/**
 * Stores one Topic per gold Big idea, in Course order, each with its KCs in
 * map order, as the Topics stage would. `ids` maps gold ids to stored ones,
 * as `insertGoldMap` returns them. With `reading`, every Topic, the next
 * one included, gets two Reading sections over its chunks: an original one
 * and a study-text one. Returns the stored Topic ids by gold Big idea id.
 */
export async function insertGoldTopics(
  supabase: AdminSupabase,
  studentId: string,
  courseId: string,
  { gold, id }: Awaited<ReturnType<typeof insertGoldMap>>,
  reading?: { materialId: string; chunkIds: string[]; studyText: string },
): Promise<Map<string, string>> {
  const topicIds = new Map(gold.bigIdeas.map((b) => [b.id, randomUUID()]));
  await insert(
    supabase,
    "topics",
    gold.bigIdeas.map((bigIdea, position) => ({
      id: topicIds.get(bigIdea.id),
      owner: studentId,
      course_id: courseId,
      big_idea_id: id(bigIdea.id),
      name: bigIdea.name,
      central_question:
        CENTRAL_QUESTIONS[bigIdea.id] ?? `What is ${bigIdea.name}?`,
      why_it_matters: bigIdea.description,
      position,
    })),
  );
  await insert(
    supabase,
    "topic_kcs",
    gold.bigIdeas.flatMap((bigIdea) =>
      gold.kcs
        .filter((kc) => kc.bigIdea === bigIdea.id)
        .map((kc, position) => ({
          topic_id: topicIds.get(bigIdea.id),
          kc_id: id(kc.id),
          owner: studentId,
          position,
        })),
    ),
  );
  if (reading) {
    const section = {
      owner: studentId,
      course_id: courseId,
      material_id: reading.materialId,
      page_from: 1,
      page_to: 1,
      chunk_ids: reading.chunkIds,
      annotations: null,
    };
    await insert(
      supabase,
      "reading_sections",
      [...topicIds.values()].flatMap((topicId) => [
        {
          ...section,
          topic_id: topicId,
          position: 0,
          mode: "original",
          reason: "Short and clear as written.",
          study_text: null,
        },
        {
          ...section,
          topic_id: topicId,
          position: 1,
          mode: "study_text",
          reason: "Dense: a study text explains it step by step.",
          study_text: reading.studyText,
        },
      ]),
    );
  }
  return topicIds;
}
