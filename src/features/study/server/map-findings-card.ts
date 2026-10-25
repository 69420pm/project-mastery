import "server-only";
import { z } from "zod";
import { loadChunkSources } from "@/features/ingestion/server";
import { chunkLink, readingLabel } from "@/features/study/server/source-view";
import type { MapFindingItem, MapFindingKind } from "@/features/study/types";
import { getUser } from "@/lib/auth/user";
import { failed } from "@/lib/supabase/failed";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in Student's open and accepted map Findings of a Course for the
 * Map findings card, oldest first, with their KCs' names and the quoted
 * chunk's page. Empty for an unknown or another Student's Course.
 */
export async function getMapFindings(
  courseId: string,
): Promise<MapFindingItem[]> {
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("map_findings")
    .select(
      "id, kind, status, reason, quote, chunk_id, kc:kcs!map_findings_kc_id_fkey(name), linked:kcs!map_findings_linked_kc_id_fkey(name)",
    )
    .eq("course_id", courseId)
    .in("status", ["open", "accepted"])
    .order("created_at");
  if (error) failed("Loading the map Findings", error);
  if (data.length === 0) return [];
  const chunks = new Map(
    (
      await loadChunkSources(
        supabase,
        data.map((row) => row.chunk_id),
      )
    ).map((chunk) => [chunk.id, chunk]),
  );
  return data.map((row) => {
    const chunk = chunks.get(row.chunk_id);
    return {
      id: row.id,
      kind: row.kind as MapFindingKind,
      status: row.status as MapFindingItem["status"],
      kc: row.kc.name,
      linkedKc: row.linked?.name ?? null,
      reason: row.reason,
      quote: row.quote,
      source: chunk
        ? { label: readingLabel(chunk), link: chunkLink(courseId, chunk) }
        : null,
    };
  });
}
