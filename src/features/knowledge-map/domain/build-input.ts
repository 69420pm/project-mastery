import {
  exerciseName,
  type ExerciseSubtask,
} from "@/features/knowledge-map/domain/exercises";
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

/** An exercise subtask with what its `exercise` call reads. */
export type ExerciseInput = ExerciseSubtask & {
  markdown: string;
  /** The paired solution chunk's markdown, or null without one. */
  solution: string | null;
};

/**
 * Every `exercise` chunk as a subtask in reading order, with local ids
 * "e1", "e2", …, its name as printed and its paired solution from `pairs`
 * (exercise chunk id to solution chunk id). A solution chunk outside
 * `chunks` counts as none. A name printed more than once in the Course, such
 * as an Example and an Exercise both numbered 7.1, gets its place appended.
 */
export function exerciseInputs(
  chunks: Array<MapChunk & { pageFrom: number; exerciseNumber: string | null }>,
  pairs: Record<string, string | null>,
): ExerciseInput[] {
  const markdown = new Map(chunks.map((chunk) => [chunk.id, chunk.markdown]));
  const exercises = chunks
    .filter((chunk) => chunk.label === "exercise")
    .map((chunk) => {
      const place = `${chunk.materialName} p. ${chunk.pageFrom}`;
      return { chunk, place, name: exerciseName(chunk.exerciseNumber, place) };
    });
  const counts = new Map<string, number>();
  for (const { name } of exercises) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return exercises.map(({ chunk, place, name }, index) => {
    const solutionChunkId = pairs[chunk.id] ?? null;
    const solution =
      solutionChunkId === null ? null : (markdown.get(solutionChunkId) ?? null);
    return {
      id: `e${index + 1}`,
      name:
        (counts.get(name) ?? 0) > 1 && chunk.exerciseNumber?.trim()
          ? `${name} (${place})`
          : name,
      questionChunkId: chunk.id,
      solutionChunkId: solution === null ? null : solutionChunkId,
      markdown: chunk.markdown,
      solution,
    };
  });
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
