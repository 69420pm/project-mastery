import "server-only";
import type { ChunkFinding } from "@/features/ingestion";
import { groupFindingsByChunk } from "@/features/knowledge-map/domain/chunk-findings";
import { getUser } from "@/lib/auth/user";
import { allRows } from "@/lib/supabase/all-rows";
import { createClient } from "@/lib/supabase/server";

/**
 * The Findings about the chunks of one Material, by chunk id, in map order,
 * each with its text, status and answer. Chunks without Findings are absent.
 * Row Level Security scopes every read.
 */
export async function getChunkFindings(
  courseId: string,
  materialId: string,
): Promise<Record<string, ChunkFinding[]>> {
  if (!(await getUser())) return {};
  const supabase = await createClient();

  const chunks = await allRows("Loading the chunks", (from, to) =>
    supabase
      .from("chunks")
      .select("id")
      .eq("material_id", materialId)
      .order("id")
      .range(from, to),
  );
  if (chunks.length === 0) return {};

  // By Course, not by chunk id: a long Material's ids would not fit the URL.
  const sources = await allRows("Loading the finding sources", (from, to) =>
    supabase
      .from("finding_sources")
      .select("finding_id, chunk_id")
      .eq("course_id", courseId)
      .order("finding_id")
      .order("chunk_id")
      .range(from, to),
  );
  const chunkIds = new Set(chunks.map(({ id }) => id));
  if (!sources.some((source) => chunkIds.has(source.chunk_id))) return {};

  const findings = await allRows("Loading the findings", (from, to) =>
    supabase
      .from("findings")
      .select("id, text, status, answer")
      .eq("course_id", courseId)
      .order("position")
      .order("id")
      .range(from, to),
  );
  return groupFindingsByChunk(findings, sources, chunkIds);
}
