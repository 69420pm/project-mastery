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
  /** Where the figure is in the Material's file: a page and a box on it. */
  figure: {
    description: string;
    page: number;
    /** Normalized to the page; null when the figure is the whole page. */
    box: { x: number; y: number; width: number; height: number } | null;
  } | null;
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
  /**
   * A short-lived link to the Material's file, for the pages of the figures.
   * Null when no chunk has a figure, or the link could not be signed.
   */
  file: { url: string; mediaType: string } | null;
  exam: { year: number | null; totalPoints: number | null } | null;
  chunks: ChunkView[];
};
