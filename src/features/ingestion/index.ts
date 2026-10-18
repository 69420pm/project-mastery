// Public API of the ingestion feature for any code, client or server.
// Server-only exports live in `server.ts`. It never imports the courses
// feature, which starts parses and links to the chunk view.
export { ChunkList } from "./components/chunk-list";
export {
  canStartParse,
  isParseRunning,
  parseStateLabel,
  type ParseState,
} from "./domain/parse-state";
export { startMaterialParse } from "./server/actions";
export type { ChunkFinding, ParseStatus } from "./types";
