// Public API of the ingestion feature for server code only: starting a
// Material's parse or a Course's pairing, and reading its chunks.
import "server-only";

export { getMaterialChunks } from "./server/chunk-queries";
export {
  getChunkPlaces,
  loadCourseChunks,
  type ChunkPlace,
  type CourseChunk,
} from "./server/course-chunks";
export { startPairing } from "./server/start-pairing";
export { startParse } from "./server/start-parse";
export { pairCourse } from "./workflows/pair-exercises";
export { parseMaterial } from "./workflows/parse-material";
