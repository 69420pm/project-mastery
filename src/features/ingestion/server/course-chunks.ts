import "server-only";
import { z } from "zod";
import { CHUNK_LABELS, type ChunkLabel } from "@/features/ingestion/types";
import { getUser } from "@/lib/auth/user";
import { allRows } from "@/lib/supabase/all-rows";
import { createClient } from "@/lib/supabase/server";
import type { AdminSupabase, Supabase } from "@/lib/supabase/types";

/** A chunk of a parsed Material, as a Course-wide pipeline reads it. */
export type CourseChunk = {
  id: string;
  materialId: string;
  materialName: string;
  pageFrom: number;
  label: ChunkLabel;
  markdown: string;
  /** As printed, such as "7.2b"; null for chunks that are no exercise. */
  exerciseNumber: string | null;
};

function failed(action: string, error: { message: string }): never {
  throw new Error(`${action} failed: ${error.message}`);
}

/** Where a chunk is: its Material, first page and position. */
export type ChunkPlace = {
  id: string;
  materialId: string;
  pageFrom: number;
  position: number;
};

/**
 * Where the signed-in Student's chunks among `chunkIds` are. Row Level
 * Security leaves out other Students' chunks; deleted ones are missing.
 * Reads with `client`, a Student's session client, when given.
 */
export async function getChunkPlaces(
  chunkIds: string[],
  client?: Supabase,
): Promise<ChunkPlace[]> {
  if (chunkIds.length === 0) return [];
  if (!client && !(await getUser())) return [];
  const supabase = client ?? (await createClient());
  const ids = [...new Set(chunkIds)];
  const places: ChunkPlace[] = [];
  // Ids go in the query string, so long lists are read in slices.
  for (let start = 0; start < ids.length; start += ID_SLICE) {
    const { data, error } = await supabase
      .from("chunks")
      .select("id, material_id, page_from, position")
      .in("id", ids.slice(start, start + ID_SLICE));
    if (error) failed("Loading the chunks", error);
    for (const chunk of data) {
      places.push({
        id: chunk.id,
        materialId: chunk.material_id,
        pageFrom: chunk.page_from,
        position: chunk.position,
      });
    }
  }
  return places;
}

/** A chunk with its text and where it is, as the AI cites it. */
export type ChunkSource = {
  id: string;
  materialId: string;
  materialName: string;
  pageFrom: number;
  pageTo: number;
  markdown: string;
  /** Whether its Material is an old exam. */
  isExam: boolean;
};

/**
 * The chunks among `chunkIds` that `supabase`, a Student's session client,
 * may read, in reading order: Materials in upload order, chunks by
 * position. Deleted chunks are missing.
 */
export async function loadChunkSources(
  supabase: Supabase,
  chunkIds: string[],
): Promise<ChunkSource[]> {
  const ids = [...new Set(chunkIds)];
  const rows = [];
  // Ids go in the query string, so long lists are read in slices.
  for (let start = 0; start < ids.length; start += ID_SLICE) {
    const { data, error } = await supabase
      .from("chunks")
      .select("id, material_id, position, page_from, page_to, markdown")
      .in("id", ids.slice(start, start + ID_SLICE));
    if (error) failed("Loading the chunks", error);
    rows.push(...data);
  }
  if (rows.length === 0) return [];

  const materials = await supabase
    .from("materials")
    .select("id, name, created_at, is_exam")
    .in("id", [...new Set(rows.map((row) => row.material_id))]);
  if (materials.error) failed("Loading the Materials", materials.error);
  const material = new Map(materials.data.map((m) => [m.id, m]));
  return rows
    .filter((row) => material.has(row.material_id))
    .toSorted(
      (a, b) =>
        material
          .get(a.material_id)!
          .created_at.localeCompare(material.get(b.material_id)!.created_at) ||
        a.position - b.position,
    )
    .map((row) => ({
      id: row.id,
      materialId: row.material_id,
      materialName: material.get(row.material_id)!.name,
      pageFrom: row.page_from,
      pageTo: row.page_to,
      markdown: row.markdown,
      isExam: material.get(row.material_id)!.is_exam === true,
    }));
}

/**
 * The Course's exercise subtask chunks with their paired solution chunks,
 * as the last pairing pass stored them: exercise chunk id to solution chunk
 * id, or null without a solution. Reads on the admin client, or on a
 * Student's session client, where Row Level Security scopes it.
 */
export async function loadExerciseSolutions(
  supabase: Supabase,
  courseId: string,
): Promise<Record<string, string | null>> {
  const pairs: Record<string, string | null> = {};
  for (let from = 0; ; from += PAGE) {
    const page = await supabase
      .from("exercise_solutions")
      .select("exercise_chunk_id, solution_chunk_id")
      .eq("course_id", courseId)
      .order("exercise_chunk_id")
      .range(from, from + PAGE - 1);
    if (page.error) failed("Loading the exercise solutions", page.error);
    for (const pair of page.data) {
      pairs[pair.exercise_chunk_id] = pair.solution_chunk_id;
    }
    if (page.data.length < PAGE) return pairs;
  }
}

/** Chunk ids per `in` filter, which keeps the query string short. */
const ID_SLICE = 100;

/** Rows per page; PostgREST returns at most 1000 rows per request. */
const PAGE = 1000;

/**
 * Every chunk of the Course's `parsed` Materials in reading order: Materials
 * in upload order, chunks by position. For workflows on the admin client,
 * so it scopes the reads to the Course itself.
 */
export async function loadCourseChunks(
  supabase: AdminSupabase,
  courseId: string,
): Promise<CourseChunk[]> {
  const materials = await supabase
    .from("materials")
    .select("id, name")
    .eq("course_id", courseId)
    .eq("parse_status", "parsed")
    .order("created_at");
  if (materials.error) failed("Loading the Materials", materials.error);
  if (materials.data.length === 0) return [];

  const chunks: CourseChunk[] = [];
  for (const material of materials.data) {
    // Paged, so a long Material is never cut off at the row limit.
    for (let from = 0; ; from += PAGE) {
      const page = await supabase
        .from("chunks")
        .select("id, position, page_from, label, markdown, exercise_number")
        .eq("material_id", material.id)
        .order("position")
        .range(from, from + PAGE - 1);
      if (page.error) failed("Loading the chunks", page.error);
      for (const chunk of page.data) {
        chunks.push({
          id: chunk.id,
          materialId: material.id,
          materialName: material.name,
          pageFrom: chunk.page_from,
          label: z.enum(CHUNK_LABELS).parse(chunk.label),
          markdown: chunk.markdown,
          exerciseNumber: chunk.exercise_number,
        });
      }
      if (page.data.length < PAGE) break;
    }
  }
  return chunks;
}

/** A chunk's printed points and its Material, as Priorities weighs them. */
export type ChunkPoints = {
  id: string;
  materialId: string;
  materialName: string;
  /** Whether its Material is an old exam. */
  isExam: boolean;
  /** As printed; null when the chunk prints none. */
  points: number | null;
};

/**
 * Every chunk of the Course with its printed points, Material name and
 * whether the Material is an old exam. For workflows on the admin client,
 * so it scopes the reads to the Course itself.
 */
export async function loadChunkPoints(
  supabase: AdminSupabase,
  courseId: string,
): Promise<ChunkPoints[]> {
  const [chunks, materials] = await Promise.all([
    allRows("Loading the chunks", (from, to) =>
      supabase
        .from("chunks")
        .select("id, material_id, points")
        .eq("course_id", courseId)
        .order("id")
        .range(from, to),
    ),
    supabase
      .from("materials")
      .select("id, name, is_exam")
      .eq("course_id", courseId),
  ]);
  if (materials.error) failed("Loading the Materials", materials.error);
  const material = new Map(materials.data.map((m) => [m.id, m]));
  return chunks.flatMap((chunk) => {
    const of = material.get(chunk.material_id);
    if (!of) return [];
    return [
      {
        id: chunk.id,
        materialId: chunk.material_id,
        materialName: of.name,
        isExam: of.is_exam === true,
        points: chunk.points === null ? null : Number(chunk.points),
      },
    ];
  });
}
