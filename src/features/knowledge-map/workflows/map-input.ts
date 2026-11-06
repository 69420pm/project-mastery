import "server-only";
import { examChapterIds } from "@/features/ingestion/server";
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
  /** In Course order: Materials by position, then their Outlines in order. */
  chapters: Array<{
    id: string;
    materialId: string;
    title: string;
    depth: number;
    /** Whether it is in an old exam: a confirmed one or below one. */
    inExam: boolean;
  }>;
  /** The Course's Materials by position. */
  materials: Array<{ id: string; name: string }>;
  kcs: Array<{
    id: string;
    name: string;
    description: string;
    origin: string;
    sources: string[];
  }>;
  prerequisites: Link[];
  /** Each Exercise's live KCs. */
  exercises: string[][];
};

export async function loadMapInput(
  supabase: AdminSupabase,
  courseId: string,
): Promise<MapInput> {
  const [materials, chapters, chunks, kcs, sources, links, tested] =
    await Promise.all([
      supabase
        .from("materials")
        .select("id, name")
        .eq("course_id", courseId)
        .order("position"),
      allRows("Loading the Chapters", (from, to) =>
        supabase
          .from("chapters")
          .select("id, material_id, parent_id, title, depth, is_exam")
          .eq("course_id", courseId)
          .order("material_id")
          .order("position")
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
          .select("id, name, description, origin")
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
      allRows("Loading the exercise KCs", (from, to) =>
        supabase
          .from("exercise_kcs")
          .select("exercise_id, kc_id")
          .eq("course_id", courseId)
          .order("exercise_id")
          .order("kc_id")
          .range(from, to),
      ),
    ]);
  if (materials.error) failed("Loading the Materials", materials.error);

  const exams = examChapterIds(
    chapters.map((c) => ({
      id: c.id,
      parentId: c.parent_id,
      isExam: c.is_exam === true,
    })),
  );
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
    chapters: materials.data.flatMap((material) =>
      chapters
        .filter((chapter) => chapter.material_id === material.id)
        .map((chapter) => ({
          id: chapter.id,
          materialId: chapter.material_id,
          title: chapter.title,
          depth: chapter.depth,
          inExam: exams.has(chapter.id),
        })),
    ),
    materials: materials.data,
    exercises: [
      ...Map.groupBy(
        tested.filter((row) => live.has(row.kc_id)),
        (row) => row.exercise_id,
      ).values(),
    ].map((rows) => rows.map((row) => row.kc_id)),
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

/** The live KCs with a first source, in Course order. */
export function courseOrder(map: MapInput): string[] {
  const places = firstSourcePlaces(map);
  return map.kcs
    .map((kc) => kc.id)
    .filter((id) => places.has(id))
    .toSorted((a, b) => places.get(a)! - places.get(b)!);
}
