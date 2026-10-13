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
  const { data, error } = await (
    await createClient()
  )
    .from("chunks")
    .select("id, material_id, page_from, position")
    .in("id", chunkIds);
  if (error) failed("Loading the chunks", error);
  return data.map((chunk) => ({
    id: chunk.id,
    materialId: chunk.material_id,
    pageFrom: chunk.page_from,
    position: chunk.position,
  }));
}

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

  const chunks = await supabase
    .from("chunks")
    .select("id, material_id, position, page_from, label, markdown")
    .in(
      "material_id",
      materials.data.map((material) => material.id),
    )
    .order("position");
  if (chunks.error) failed("Loading the chunks", chunks.error);

  return materials.data.flatMap((material) =>
    chunks.data
      .filter((chunk) => chunk.material_id === material.id)
      .map((chunk) => ({
        id: chunk.id,
        materialId: material.id,
        materialName: material.name,
        pageFrom: chunk.page_from,
        label: z.enum(CHUNK_LABELS).parse(chunk.label),
        markdown: chunk.markdown,
      })),
  );
}
