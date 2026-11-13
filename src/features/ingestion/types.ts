/** The kinds of chunk a parse labels, one per chunk. */
export const CHUNK_LABELS = [
  "content",
  "exercise",
  "solution",
  "admin",
] as const;

export type ChunkLabel = (typeof CHUNK_LABELS)[number];

/** The kinds of unit a page batch gives: a heading, or a chunk's kind. */
export const UNIT_LABELS = [...CHUNK_LABELS, "heading"] as const;

export type UnitLabel = (typeof UNIT_LABELS)[number];

/** How a heading is set on the page. */
export const HEADING_STYLES = ["title", "large", "bold"] as const;

/** Why a parse stored a page without reading it (`material_pages.skipped`). */
export type PageSkip =
  "blank" | "overlay" | "unreadable" | "uncovered" | "titles";

/** The reasons a page batch answer gives for a page without units. */
export const PAGE_SKIP_REASONS = ["titles_or_contents"] as const;

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
  /** An exercise's solution; null for other chunks. */
  solution: ExerciseSolution | null;
};

/** The solution an exercise is paired with, possibly in another Material. */
export type ExerciseSolution =
  | {
      status: "paired";
      chunkId: string;
      materialId: string;
      materialName: string;
    }
  | { status: "no_solution" };

/** A parsed Material with its chunks, for the chunk view. */
export type MaterialChunks = {
  materialId: string;
  courseId: string;
  name: string;
  parseStatus: ParseStatus;
  /**
   * The titles of its old exams, as the Brief confirmed them: Chapters not
   * inside another; the Material's name when the whole Material is one.
   */
  examChapters: string[];
  chunks: ChunkView[];
};
