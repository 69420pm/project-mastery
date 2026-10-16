// Public API of the knowledge-map feature for server code only: reading a
// Course's map, its build workflow, and the review queue of open Findings
// that the Brief asks about.
import "server-only";

// Also in `index.ts`: `index.ts` loads React components, which fail outside
// Next.js, so server code that smoke checks load imports it from here.
export { knowledgeMapPath } from "./domain/map-paths";
export { getChunkFindings } from "./server/chunk-findings";
export { getKnowledgeMap } from "./server/queries";
export {
  answerFinding,
  getOpenFindings,
  markFindingAsked,
} from "./server/review";
export { loadStoredMap } from "./server/stored-map";
export { buildKnowledgeMap } from "./workflows/build-knowledge-map";
