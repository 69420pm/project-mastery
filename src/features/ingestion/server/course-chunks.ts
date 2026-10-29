import "server-only";
import { z } from "zod";
import { CHUNK_LABELS, type ChunkLabel } from "@/features/ingestion/types";
import { getUser } from "@/lib/auth/user";
import { allRows } from "@/lib/supabase/all-rows";
import { failed } from "@/lib/supabase/failed";
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

/**
 * The ids of a Material's chunks. Reads on the admin client or a Student's
 * session client, where Row Level Security leaves another Student's out.
 */
export async function loadMaterialChunkIds(
  supabase: Supabase,
  materialId: string,
): Promise<string[]> {
  const rows = await allRows("Loading the Material's chunks", (from, to) =>
    supabase
      .from("chunks")
      .select("id")
      .eq("material_id", materialId)
      .order("id")
      .range(from, to),
  );
  return rows.map(({ id }) => id);
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
  const rows = await allRows("Loading the exercise solutions", (from, to) =>
    supabase
      .from("exercise_solutions")
      .select("exercise_chunk_id, solution_chunk_id")
      .eq("course_id", courseId)
      .order("exercise_chunk_id")
      .range(from, to),
  );
  const pairs: Record<string, string | null> = {};
  for (const pair of rows) {
    pairs[pair.exercise_chunk_id] = pair.solution_chunk_id;
  }
  return pairs;
}

/** A chunk's text as a Reading section shows it. */
export type ChunkText = {
  id: string;
  pageFrom: number;
  pageTo: number;
  label: ChunkLabel;
  markdown: string;
  /** What its figure shows; null without one. */
  figureDescription: string | null;
};

const figureSchema = z.object({ description: z.string() }).nullable();

/**
 * The texts of the chunks among `chunkIds` that `supabase` may read, by id;
 * deleted ones are missing. Reads on the admin client, or on a Student's
 * session client, where Row Level Security scopes it.
 */
export async function loadChunkTexts(
  supabase: Supabase,
  chunkIds: string[],
): Promise<Record<string, ChunkText>> {
  const ids = [...new Set(chunkIds)];
  const texts: Record<string, ChunkText> = {};
  // Ids go in the query string, so long lists are read in slices.
  for (let start = 0; start < ids.length; start += ID_SLICE) {
    const { data, error } = await supabase
      .from("chunks")
      .select("id, page_from, page_to, label, markdown, figure")
      .in("id", ids.slice(start, start + ID_SLICE));
    if (error) failed("Loading the chunks", error);
    for (const chunk of data) {
      texts[chunk.id] = {
        id: chunk.id,
        pageFrom: chunk.page_from,
        pageTo: chunk.page_to,
        label: z.enum(CHUNK_LABELS).parse(chunk.label),
        markdown: chunk.markdown,
        figureDescription:
          figureSchema.safeParse(chunk.figure).data?.description ?? null,
      };
    }
  }
  return texts;
}

/** Chunk ids per `in` filter, which keeps the query string short. */
const ID_SLICE = 100;

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
    const rows = await allRows("Loading the chunks", (from, to) =>
      supabase
        .from("chunks")
        .select("id, position, page_from, label, markdown, exercise_number")
        .eq("material_id", material.id)
        .order("position")
        .range(from, to),
    );
    for (const chunk of rows) {
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
  }
  return chunks;
}

/** Where a chunk is in the Course, without its text. */
export type ChunkSpan = {
  id: string;
  materialId: string;
  materialName: string;
  pageFrom: number;
  pageTo: number;
};

/**
 * The places of every chunk of the Course's `parsed` Materials in reading
 * order: Materials in upload order, chunks by position. Reads on the admin
 * client, or on a Student's session client, where Row Level Security scopes
 * it.
 */
export async function loadCourseChunkSpans(
  supabase: Supabase,
  courseId: string,
): Promise<ChunkSpan[]> {
  const materials = await supabase
    .from("materials")
    .select("id, name")
    .eq("course_id", courseId)
    .eq("parse_status", "parsed")
    .order("created_at");
  if (materials.error) failed("Loading the Materials", materials.error);

  const spans: ChunkSpan[] = [];
  for (const material of materials.data) {
    const rows = await allRows("Loading the chunks", (from, to) =>
      supabase
        .from("chunks")
        .select("id, page_from, page_to")
        .eq("material_id", material.id)
        .order("position")
        .range(from, to),
    );
    for (const chunk of rows) {
      spans.push({
        id: chunk.id,
        materialId: material.id,
        materialName: material.name,
        pageFrom: chunk.page_from,
        pageTo: chunk.page_to,
      });
    }
  }
  return spans;
}

/**
 * Where one chunk of the Course is, or null when the Course has no chunk
 * with this id. On a Student's session client, Row Level Security leaves
 * out another Student's chunks.
 */
export async function findChunkSpan(
  supabase: Supabase,
  courseId: string,
  chunkId: string,
): Promise<ChunkSpan | null> {
  const { data, error } = await supabase
    .from("chunks")
    .select("id, material_id, page_from, page_to, materials(name)")
    .eq("course_id", courseId)
    .eq("id", chunkId)
    .maybeSingle();
  if (error) failed("Loading the chunk", error);
  return (
    data && {
      id: data.id,
      materialId: data.material_id,
      materialName: data.materials?.name ?? "",
      pageFrom: data.page_from,
      pageTo: data.page_to,
    }
  );
}

/** A Course's chunks' Materials, as Priorities weighs them. */
export type ChunkMaterials = {
  /** Each chunk's Material id by chunk id. */
  chunkMaterials: Record<string, string>;
  /** The Course's Materials by id: name and whether it is an old exam. */
  materials: Record<string, { name: string; isExam: boolean }>;
};

/**
 * Every chunk of the Course with its Material, and the Course's Materials.
 * Scopes the reads to the Course, so it reads on the admin client or a
 * Student's session client alike.
 */
export async function loadChunkMaterials(
  supabase: Supabase,
  courseId: string,
): Promise<ChunkMaterials> {
  const [chunks, materials] = await Promise.all([
    allRows("Loading the chunks", (from, to) =>
      supabase
        .from("chunks")
        .select("id, material_id")
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
  return {
    chunkMaterials: Object.fromEntries(
      chunks.map((chunk) => [chunk.id, chunk.material_id]),
    ),
    materials: Object.fromEntries(
      materials.data.map((m) => [
        m.id,
        { name: m.name, isExam: m.is_exam === true },
      ]),
    ),
  };
}
