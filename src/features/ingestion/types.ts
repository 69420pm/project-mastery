/** The kinds of chunk a parse labels, one per chunk. */
export const CHUNK_LABELS = [
  "content",
  "definition",
  "example",
  "exercise",
  "solution",
  "figure",
  "admin",
] as const;

export type ChunkLabel = (typeof CHUNK_LABELS)[number];

/** Where a Material's parse stands. */
export type ParseStatus =
  "not_parsed" | "queued" | "parsing" | "parsed" | "failed";

/** A chunk as the chunk view shows it. */
export type ChunkView = {
  id: string;
  position: number;
  pageFrom: number;
  pageTo: number;
  label: ChunkLabel;
  markdown: string;
  /** What a figure chunk shows, in words. */
  figure: { description: string } | null;
  exerciseNumber: string | null;
  points: number | null;
  /** An exercise subtask's solution; null for other chunks. */
  solution: ExerciseSolution | null;
};

/** The solution an exercise is paired with, possibly in another Material. */
export type ExerciseSolution =
  | {
      status: "paired";
      chunkId: string;
      materialId: string;
      materialName: string;
      exerciseNumber: string | null;
    }
  | { status: "no_solution" };

/** A parsed Material with its chunks, for the chunk view. */
export type MaterialChunks = {
  materialId: string;
  courseId: string;
  name: string;
  parseStatus: ParseStatus;
  exam: { year: number | null; totalPoints: number | null } | null;
  chunks: ChunkView[];
};
