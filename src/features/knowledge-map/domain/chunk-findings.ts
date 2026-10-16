import type { ChunkFinding } from "@/features/ingestion";

type FindingRow = {
  id: string;
  text: string;
  status: string;
  answer: string | null;
};

/**
 * Groups Findings under the chunks they are about, in the order of
 * `findings`. A Finding about several chunks shows under each. Sources on
 * chunks outside `chunkIds` are left out.
 */
export function groupFindingsByChunk(
  findings: FindingRow[],
  sources: { finding_id: string; chunk_id: string }[],
  chunkIds: Set<string>,
): Record<string, ChunkFinding[]> {
  const result: Record<string, ChunkFinding[]> = {};
  for (const finding of findings) {
    for (const source of sources) {
      if (source.finding_id !== finding.id) continue;
      if (!chunkIds.has(source.chunk_id)) continue;
      (result[source.chunk_id] ??= []).push({
        id: finding.id,
        text: finding.text,
        status: finding.status === "answered" ? "answered" : "open",
        answer: finding.answer,
      });
    }
  }
  return result;
}
