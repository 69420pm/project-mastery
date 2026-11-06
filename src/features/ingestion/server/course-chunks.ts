import "server-only";
import { z } from "zod";
import {
  chapterSubtree,
  examChapterIds,
  type ExamChapterNode,
} from "@/features/ingestion/domain/old-exam-chapters";
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

/** A chunk with its text and where it is, as the AI cites it. */
export type ChunkSource = {
  id: string;
  materialId: string;
  materialName: string;
  pageFrom: number;
  pageTo: number;
  markdown: string;
  /** Its deepest Chapter's title; null when it is in none below the root. */
  chapterTitle: string | null;
  /** Whether its Chapter, or one above it, is an old exam. */
  isExam: boolean;
};

/**
 * The chunks among `chunkIds` that `supabase`, a Student's session client,
 * may read, in Course order: Materials by position, then chunks by
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
      .select(
        "id, material_id, position, page_from, page_to, markdown, chapter_id",
      )
      .in("id", ids.slice(start, start + ID_SLICE));
    if (error) failed("Loading the chunks", error);
    rows.push(...data);
  }
  if (rows.length === 0) return [];

  const materialIds = [...new Set(rows.map((row) => row.material_id))];
  const [materials, chapters] = await Promise.all([
    supabase
      .from("materials")
      .select("id, name, position")
      .in("id", materialIds),
    loadMaterialChapters(supabase, materialIds),
  ]);
  if (materials.error) failed("Loading the Materials", materials.error);
  const material = new Map(materials.data.map((m) => [m.id, m]));
  // A root Chapter's title is its Material's name, so it is left out.
  const chapterTitles = new Map(
    chapters.flatMap((c) => (c.depth > 0 ? [[c.id, c.title]] : [])),
  );
  const examChapters = examChapterIds(chapters);
  return rows
    .filter((row) => material.has(row.material_id))
    .toSorted(
      (a, b) =>
        material.get(a.material_id)!.position -
          material.get(b.material_id)!.position || a.position - b.position,
    )
    .map((row) => ({
      id: row.id,
      materialId: row.material_id,
      materialName: material.get(row.material_id)!.name,
      pageFrom: row.page_from,
      pageTo: row.page_to,
      markdown: row.markdown,
      chapterTitle: chapterTitles.get(row.chapter_id ?? "") ?? null,
      isExam: examChapters.has(row.chapter_id ?? ""),
    }));
}

/** A Chapter with its place in the tree and old-exam answer. */
type StoredChapter = ExamChapterNode & {
  materialId: string;
  title: string;
  depth: number;
};

/** Every Chapter of these Materials. No ids make no request. */
async function loadMaterialChapters(
  supabase: Supabase,
  materialIds: string[],
): Promise<StoredChapter[]> {
  const chapters: StoredChapter[] = [];
  for (let start = 0; start < materialIds.length; start += ID_SLICE) {
    const rows = await allRows("Loading the Chapters", (from, to) =>
      supabase
        .from("chapters")
        .select("id, material_id, parent_id, title, depth, is_exam")
        .in("material_id", materialIds.slice(start, start + ID_SLICE))
        .order("id")
        .range(from, to),
    );
    chapters.push(...rows.map(storedChapter));
  }
  return chapters;
}

function storedChapter(row: {
  id: string;
  material_id: string;
  parent_id: string | null;
  title: string;
  depth: number;
  is_exam: boolean | null;
}): StoredChapter {
  return {
    id: row.id,
    materialId: row.material_id,
    parentId: row.parent_id,
    title: row.title,
    depth: row.depth,
    isExam: row.is_exam === true,
  };
}

/**
 * The ids of the chunks in a Chapter's subtree: for a reserved old exam,
 * the chunks it hides. Empty when the Chapter is gone. Reads on the admin
 * client or a Student's session client, where Row Level Security leaves
 * another Student's out.
 */
export async function loadChapterChunkIds(
  supabase: Supabase,
  chapterId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("chapters")
    .select("material_id")
    .eq("id", chapterId)
    .maybeSingle();
  if (error) failed("Loading the Chapter", error);
  if (!data) return [];
  const chapters = await loadMaterialChapters(supabase, [data.material_id]);
  const subtree = chapterSubtree(chapters, chapterId);
  const rows = await allRows("Loading the Chapter's chunks", (from, to) =>
    supabase
      .from("chunks")
      .select("id, chapter_id")
      .eq("material_id", data.material_id)
      .order("id")
      .range(from, to),
  );
  return rows
    .filter((row) => subtree.has(row.chapter_id ?? ""))
    .map(({ id }) => id);
}

/** A chunk's text as a Reading section shows it. */
export type ChunkText = {
  id: string;
  pageFrom: number;
  pageTo: number;
  label: ChunkLabel;
  markdown: string;
};

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
      .select("id, page_from, page_to, label, markdown")
      .in("id", ids.slice(start, start + ID_SLICE));
    if (error) failed("Loading the chunks", error);
    for (const chunk of data) {
      texts[chunk.id] = {
        id: chunk.id,
        pageFrom: chunk.page_from,
        pageTo: chunk.page_to,
        label: z.enum(CHUNK_LABELS).parse(chunk.label),
        markdown: chunk.markdown,
      };
    }
  }
  return texts;
}

/** Chunk ids per `in` filter, which keeps the query string short. */
const ID_SLICE = 100;

/**
 * Every chunk of the Course's `parsed` Materials in Course order: Materials
 * by position, then chunks by position. For workflows on the admin client,
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
    .order("position");
  if (materials.error) failed("Loading the Materials", materials.error);
  if (materials.data.length === 0) return [];

  const chunks: CourseChunk[] = [];
  for (const material of materials.data) {
    const rows = await allRows("Loading the chunks", (from, to) =>
      supabase
        .from("chunks")
        .select("id, position, page_from, label, markdown")
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
      });
    }
  }
  return chunks;
}

/** Where a chunk is in the Course, and its label, without its text. */
export type ChunkSpan = {
  id: string;
  materialId: string;
  materialName: string;
  pageFrom: number;
  pageTo: number;
  label: string;
};

/**
 * The places of every chunk of the Course's `parsed` Materials in Course
 * order: Materials by position, then chunks by position. Reads on the admin
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
    .order("position");
  if (materials.error) failed("Loading the Materials", materials.error);

  const spans: ChunkSpan[] = [];
  for (const material of materials.data) {
    const rows = await allRows("Loading the chunks", (from, to) =>
      supabase
        .from("chunks")
        .select("id, page_from, page_to, label")
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
        label: chunk.label,
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
    .select("id, material_id, page_from, page_to, label, materials(name)")
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
      label: data.label,
    }
  );
}

/** A Course's chunks' Materials, as Priorities weighs them. */
export type ChunkMaterials = {
  /** Each chunk's Material id by chunk id. */
  chunkMaterials: Record<string, string>;
  /** The Course's Materials' names by id. */
  materials: Record<string, { name: string }>;
  /** The chunks in an old exam: their Chapter or one above it is one. */
  examChunkIds: string[];
};

/**
 * Every chunk of the Course with its Material, the Course's Materials and
 * its old-exam chunks. Scopes the reads to the Course, so it reads on the
 * admin client or a Student's session client alike.
 */
export async function loadChunkMaterials(
  supabase: Supabase,
  courseId: string,
): Promise<ChunkMaterials> {
  const [chunks, materials, chapters] = await Promise.all([
    allRows("Loading the chunks", (from, to) =>
      supabase
        .from("chunks")
        .select("id, material_id, chapter_id")
        .eq("course_id", courseId)
        .order("id")
        .range(from, to),
    ),
    supabase.from("materials").select("id, name").eq("course_id", courseId),
    allRows("Loading the Chapters", (from, to) =>
      supabase
        .from("chapters")
        .select("id, material_id, parent_id, title, depth, is_exam")
        .eq("course_id", courseId)
        .order("id")
        .range(from, to),
    ),
  ]);
  if (materials.error) failed("Loading the Materials", materials.error);
  const examChapters = examChapterIds(chapters.map(storedChapter));
  return {
    chunkMaterials: Object.fromEntries(
      chunks.map((chunk) => [chunk.id, chunk.material_id]),
    ),
    materials: Object.fromEntries(
      materials.data.map((m) => [m.id, { name: m.name }]),
    ),
    examChunkIds: chunks
      .filter((chunk) => examChapters.has(chunk.chapter_id ?? ""))
      .map(({ id }) => id),
  };
}

/** An admin chunk: an organizational remark, such as "Chapter 2 is not examined". */
export type AdminChunk = {
  materialName: string;
  pageFrom: number;
  markdown: string;
};

/**
 * The Course's admin chunks in Course order: Materials by position, then
 * chunks by position. Scopes the reads to the Course, so it reads on the
 * admin client or a Student's session client alike.
 */
export async function loadAdminChunks(
  supabase: Supabase,
  courseId: string,
): Promise<AdminChunk[]> {
  const [materials, chunks] = await Promise.all([
    supabase
      .from("materials")
      .select("id, name")
      .eq("course_id", courseId)
      .order("position"),
    allRows("Loading the admin chunks", (from, to) =>
      supabase
        .from("chunks")
        .select("material_id, position, page_from, markdown")
        .eq("course_id", courseId)
        .eq("label", "admin")
        .order("material_id")
        .order("position")
        .range(from, to),
    ),
  ]);
  if (materials.error) failed("Loading the Materials", materials.error);
  return materials.data.flatMap((material) =>
    chunks
      .filter((chunk) => chunk.material_id === material.id)
      .map((chunk) => ({
        materialName: material.name,
        pageFrom: chunk.page_from,
        markdown: chunk.markdown,
      })),
  );
}
