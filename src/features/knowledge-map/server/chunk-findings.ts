import "server-only";
import type { ChunkFinding } from "@/features/ingestion";
import { groupFindingsByChunk } from "@/features/knowledge-map/domain/chunk-findings";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

function failed(action: string, error: { message: string }): never {
  throw new Error(`${action} failed: ${error.message}`);
}

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

  const chunks = await supabase
    .from("chunks")
    .select("id")
    .eq("material_id", materialId);
  if (chunks.error) failed("Loading the chunks", chunks.error);
  if (chunks.data.length === 0) return {};

  const sources = await supabase
    .from("finding_sources")
    .select("finding_id, chunk_id")
    .eq("course_id", courseId)
    .in(
      "chunk_id",
      chunks.data.map(({ id }) => id),
    );
  if (sources.error) failed("Loading the finding sources", sources.error);
  if (sources.data.length === 0) return {};

  const findings = await supabase
    .from("findings")
    .select("id, text, status, answer")
    .eq("course_id", courseId)
    .in("id", [...new Set(sources.data.map(({ finding_id }) => finding_id))])
    .order("position");
  if (findings.error) failed("Loading the findings", findings.error);

  return groupFindingsByChunk(
    findings.data,
    sources.data,
    new Set(chunks.data.map(({ id }) => id)),
  );
}
