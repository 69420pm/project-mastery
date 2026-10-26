import "server-only";
import { getReservedExam } from "@/features/brief/server";
import { loadMaterialChunkIds } from "@/features/ingestion/server";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The chunks of the Course's active reserved exam, which the tutor and
 * problem generation leave out: its Exercises (by question chunk), search
 * results, source chunks and Reading sections. Empty without a reservation.
 * Reads on a Student's session client or the admin client.
 */
export async function loadReservedChunks(
  supabase: Supabase,
  courseId: string,
): Promise<Set<string>> {
  const materialId = await getReservedExam(supabase, courseId);
  return new Set(
    materialId === null ? [] : await loadMaterialChunkIds(supabase, materialId),
  );
}

/** The map with the Exercises whose question is a reserved chunk left out. */
export function withoutReserved<Map extends { exercises: Exercise[] }>(
  map: Map,
  reserved: Set<string>,
): Map {
  if (reserved.size === 0) return map;
  return {
    ...map,
    exercises: map.exercises.filter((e) => !reserved.has(e.questionChunk)),
  };
}

type Exercise = { questionChunk: string };

/**
 * The Reading sections by Topic without those that show a reserved chunk.
 * A section cuts pages of one Material, so this leaves out the reserved
 * exam's sections.
 */
export function withoutReservedSections<Section extends { chunkIds: string[] }>(
  sections: Map<string, Section[]>,
  reserved: Set<string>,
): Map<string, Section[]> {
  if (reserved.size === 0) return sections;
  return new Map(
    [...sections].map(([topicId, list]) => [
      topicId,
      list.filter(({ chunkIds }) => !chunkIds.some((id) => reserved.has(id))),
    ]),
  );
}
