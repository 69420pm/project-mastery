// Public API of the ingestion feature for server code only: starting a
// Material's parse or a Course's pairing, and reading its chunks.
import "server-only";

// Also in `index.ts`: `index.ts` loads React components, which fail outside
// Next.js, so server code that smoke checks load imports it from here.
export { chunkAnchor } from "./domain/chunk-anchor";
export { getMaterialChunks } from "./server/chunk-queries";
export {
  getChunkPlaces,
  loadChunkPoints,
  loadCourseChunks,
  loadChunkSources,
  loadExerciseSolutions,
  type ChunkPlace,
  type ChunkPoints,
  type ChunkSource,
  type CourseChunk,
} from "./server/course-chunks";
export { startPairing } from "./server/start-pairing";
export { startParse } from "./server/start-parse";
export { pairCourse } from "./workflows/pair-exercises";
export { parseMaterial } from "./workflows/parse-material";
