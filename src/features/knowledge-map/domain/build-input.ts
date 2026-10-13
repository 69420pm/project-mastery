import type { MapChunk } from "@/features/knowledge-map/types";

/** Chunks per assignment call. */
export const ASSIGNMENT_BATCH_SIZE = 10;

/** The chunk labels that teach KCs; exercises, solutions and admin do not. */
const TEACHING_LABELS = new Set(["content", "definition", "example", "figure"]);

/**
 * The chunks the assignment calls read, in batches in reading order.
 */
export function assignmentBatches(chunks: MapChunk[]): MapChunk[][] {
  const teaching = chunks.filter((chunk) => TEACHING_LABELS.has(chunk.label));
  const batches: MapChunk[][] = [];
  for (let start = 0; start < teaching.length; start += ASSIGNMENT_BATCH_SIZE) {
    batches.push(teaching.slice(start, start + ASSIGNMENT_BATCH_SIZE));
  }
  return batches;
}

/** What the skeleton call reads of the Course. */
export type SkeletonInput = {
  materials: string[];
  headings: string[];
  definitions: string[];
};

const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/gm;

/**
 * The skeleton call's input: the Material names, every markdown heading
 * once, and the markdown of every `definition` chunk, in reading order.
 */
export function skeletonInput(chunks: MapChunk[]): SkeletonInput {
  return {
    materials: [...new Set(chunks.map((chunk) => chunk.materialName))],
    headings: [
      ...new Set(
        chunks.flatMap((chunk) =>
          [...chunk.markdown.matchAll(HEADING)].map((match) => match[1] ?? ""),
        ),
      ),
    ],
    definitions: chunks
      .filter((chunk) => chunk.label === "definition")
      .map((chunk) => chunk.markdown),
  };
}
