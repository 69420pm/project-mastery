import "server-only";
import type { Link } from "@/features/knowledge-map/domain/prerequisite-cycles";
import { allRows } from "@/lib/supabase/all-rows";
import { failed } from "@/lib/supabase/failed";
import type { AdminSupabase } from "@/lib/supabase/types";

/**
 * The Course's map as the last steps of a build read it: its chunks in
 * Course order with their Chapters, its live KCs with their sources and the
 * Prerequisites between live KCs.
 */
export type MapInput = {
  /** In Course order: Materials by position, then chunks by position. */
  chunks: Array<{ id: string; chapterId: string | null; label: string }>;
  chapters: Array<{ id: string; title: string }>;
  kcs: Array<{
    id: string;
    name: string;
    description: string;
    sources: string[];
  }>;
  prerequisites: Link[];
};

export async function loadMapInput(
  supabase: AdminSupabase,
  courseId: string,
): Promise<MapInput> {
  const [materials, chapters, chunks, kcs, sources, links] = await Promise.all([
    supabase
      .from("materials")
      .select("id")
      .eq("course_id", courseId)
      .order("position"),
    allRows("Loading the Chapters", (from, to) =>
      supabase
        .from("chapters")
        .select("id, title")
        .eq("course_id", courseId)
        .order("id")
        .range(from, to),
    ),
    allRows("Loading the chunks", (from, to) =>
      supabase
        .from("chunks")
        .select("id, material_id, chapter_id, label, position")
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

  const sourcesOf = Map.groupBy(sources, (source) => source.kc_id);
  const live = new Set(kcs.map((kc) => kc.id));
  return {
    chunks: materials.data.flatMap((material) =>
      chunks
        .filter((chunk) => chunk.material_id === material.id)
        .map((chunk) => ({
          id: chunk.id,
          chapterId: chunk.chapter_id,
          label: chunk.label,
        })),
    ),
    chapters,
    kcs: kcs.map((kc) => ({
      ...kc,
      sources: (sourcesOf.get(kc.id) ?? []).map((source) => source.chunk_id),
    })),
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
