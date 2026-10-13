import "server-only";
import { z } from "zod";
import { CHUNK_LABELS, type ChunkLabel } from "@/features/ingestion/types";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import type { AdminSupabase } from "@/lib/supabase/types";

/** A chunk of a parsed Material, as a Course-wide pipeline reads it. */
export type CourseChunk = {
  id: string;
  materialId: string;
  materialName: string;
  pageFrom: number;
  label: ChunkLabel;
  markdown: string;
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
 */
export async function getChunkPlaces(
  chunkIds: string[],
): Promise<ChunkPlace[]> {
  if (chunkIds.length === 0 || !(await getUser())) return [];
  const supabase = await createClient();
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
        .select("id, position, page_from, label, markdown")
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
        });
      }
      if (page.data.length < PAGE) break;
    }
  }
  return chunks;
}
