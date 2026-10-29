/** The kinds of chunk a parse labels, one per chunk. */
export const CHUNK_LABELS = [
  "content",
  "exercise",
  "solution",
  "admin",
] as const;

export type ChunkLabel = (typeof CHUNK_LABELS)[number];

/** Why a parse stored a page without reading it (`material_pages.skipped`). */
export type PageSkip = "blank" | "overlay" | "unreadable";

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
  exerciseNumber: string | null;
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
  /** An old exam, as the Brief confirmed it. */
  isExam: boolean;
  chunks: ChunkView[];
};
