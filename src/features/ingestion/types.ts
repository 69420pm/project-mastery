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
  figure: {
    description: string;
    cropPath: string | null;
    /** A short-lived link to the picture at `cropPath`, or null. */
    imageUrl: string | null;
  } | null;
  exerciseNumber: string | null;
  points: number | null;
};

/** A parsed Material with its chunks, for the chunk view. */
export type MaterialChunks = {
  materialId: string;
  courseId: string;
  name: string;
  parseStatus: ParseStatus;
  exam: { year: number | null; totalPoints: number | null } | null;
  chunks: ChunkView[];
};
