import "server-only";
import { z } from "zod";
import { loadExcludedMaterialIds } from "@/features/brief/server";
import { loadChunkMaterials } from "@/features/ingestion/server";
import type { MapPriorities } from "@/features/knowledge-map";
import {
  loadStoredMap,
  loadStoredTopics,
} from "@/features/knowledge-map/server";
import {
  kcPriorities,
  type KcPriority,
} from "@/features/priorities/domain/priority";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import type { Supabase } from "@/lib/supabase/types";

/**
 * Every KC's Priority of a Course, computed from the stored map, the
 * Course's Materials and its Brief, read with `supabase`, the admin client
 * or a Student's session client; none before the map has KCs.
 */
async function computePriorities(
  supabase: Supabase,
  courseId: string,
): Promise<KcPriority[]> {
  const [map, topics, chunks, excludedMaterialIds] = await Promise.all([
    loadStoredMap(supabase, courseId),
    loadStoredTopics(supabase, courseId),
    loadChunkMaterials(supabase, courseId),
    loadExcludedMaterialIds(supabase, courseId),
  ]);
  const topicOf = new Map(
    topics.flatMap((topic) => topic.kcs.map((kc) => [kc, topic.id] as const)),
  );
  return kcPriorities({
    kcs: map.kcs.map((kc) => ({
      id: kc.id,
      bigIdeaId: kc.bigIdea,
      topicId: topicOf.get(kc.id) ?? null,
      sources: kc.sources,
    })),
    exercises: map.exercises.map(({ questionChunk, kcs }) => ({
      questionChunk,
      kcs,
    })),
    ...chunks,
    excludedMaterialIds,
    examScopes: [],
  });
}

/** Each KC's Priority of a Course by KC id, read with `supabase`. */
export async function loadKcPriorities(
  supabase: Supabase,
  courseId: string,
): Promise<Record<string, number>> {
  const values = await computePriorities(supabase, courseId);
  return Object.fromEntries(values.map((v) => [v.kcId, v.priority]));
}

/**
 * The signed-in Student's KC priorities of a Course as the map page shows
 * them: each KC's level, value and reasons. None for an unknown or another
 * Student's Course.
 */
export async function getPriorities(courseId: string): Promise<MapPriorities> {
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) {
    return { kcs: {} };
  }
  const values = await computePriorities(await createClient(), courseId);
  return {
    kcs: Object.fromEntries(
      values.map(({ kcId, priority, level, reasons }) => [
        kcId,
        { level, value: priority, reasons },
      ]),
    ),
  };
}
