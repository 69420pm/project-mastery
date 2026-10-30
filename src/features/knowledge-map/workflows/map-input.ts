import "server-only";
import type {
  PlanChunk,
  PlanKc,
  PlanPart,
} from "@/features/knowledge-map/domain/map-plan";
import type { Link } from "@/features/knowledge-map/domain/prerequisite-cycles";
import { loadCourseParts } from "@/features/knowledge-map/workflows/build-steps";
import { allRows } from "@/lib/supabase/all-rows";
import { failed } from "@/lib/supabase/failed";
import type { AdminSupabase } from "@/lib/supabase/types";

/**
 * The Course's map as the last steps of a build read it: its Parts and
 * chunks in Course order, its live KCs with their sources, its Exercises'
 * KCs and the Prerequisites between live KCs.
 */
export type MapInput = {
  parts: PlanPart[];
  chunks: PlanChunk[];
  kcs: Array<PlanKc & { name: string; description: string }>;
  /** Each Exercise's KC ids. */
  exercises: string[][];
  prerequisites: Link[];
};

export async function loadMapInput(
  supabase: AdminSupabase,
  courseId: string,
): Promise<MapInput> {
  const [parts, materials, chunks, kcs, sources, exerciseKcs, links] =
    await Promise.all([
      loadCourseParts(supabase, courseId),
      supabase
        .from("materials")
        .select("id, name")
        .eq("course_id", courseId)
        .order("position"),
      allRows("Loading the chunks", (from, to) =>
        supabase
          .from("chunks")
          .select("id, material_id, part_id, position")
          .eq("course_id", courseId)
          .order("material_id")
          .order("position")
          .range(from, to),
      ),
      allRows("Loading the KCs", (from, to) =>
        supabase
          .from("kcs")
          .select("id, name, description")
          .eq("course_id", courseId)
          .is("retired_at", null)
          .order("position")
          .range(from, to),
      ),
      allRows("Loading the KC sources", (from, to) =>
        supabase
          .from("kc_sources")
          .select("kc_id, chunk_id")
          .eq("course_id", courseId)
          .order("kc_id")
          .order("chunk_id")
          .range(from, to),
      ),
      allRows("Loading the exercise KCs", (from, to) =>
        supabase
          .from("exercise_kcs")
          .select("exercise_id, kc_id")
          .eq("course_id", courseId)
          .order("exercise_id")
          .order("kc_id")
          .range(from, to),
      ),
      allRows("Loading the Prerequisites", (from, to) =>
        supabase
          .from("prerequisite_links")
          .select("from_kc, to_kc")
          .eq("course_id", courseId)
          .order("from_kc")
          .order("to_kc")
          .range(from, to),
      ),
    ]);
  if (materials.error) failed("Loading the Materials", materials.error);

  const chapterOf = new Map(parts.map((part) => [part.id, part.chapterTitle]));
  const sourcesOf = Map.groupBy(sources, (source) => source.kc_id);
  const live = new Set(kcs.map((kc) => kc.id));
  return {
    parts,
    chunks: materials.data.flatMap((material) =>
      chunks
        .filter((chunk) => chunk.material_id === material.id)
        .map((chunk) => ({
          id: chunk.id,
          partId: chunk.part_id,
          // A chunk of no Part is filed under its Material.
          chapter:
            (chunk.part_id && chapterOf.get(chunk.part_id)) || material.name,
        })),
    ),
    kcs: kcs.map((kc) => ({
      ...kc,
      sources: (sourcesOf.get(kc.id) ?? []).map((source) => source.chunk_id),
    })),
    exercises: [
      ...Map.groupBy(exerciseKcs, (row) => row.exercise_id).values(),
    ].map((rows) => rows.map((row) => row.kc_id)),
    prerequisites: links
      .filter((link) => live.has(link.from_kc) && live.has(link.to_kc))
      .map((link) => ({ from: link.from_kc, to: link.to_kc })),
  };
}

/** Each live KC's first source's place in Course order. */
export function firstSourcePlaces(map: MapInput): Map<string, number> {
  const place = new Map(map.chunks.map((chunk, index) => [chunk.id, index]));
  return new Map(
    map.kcs.flatMap((kc) => {
      const places = kc.sources.flatMap((id) => place.get(id) ?? []);
      return places.length === 0 ? [] : [[kc.id, Math.min(...places)]];
    }),
  );
}
