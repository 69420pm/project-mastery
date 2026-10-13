// Public API of the knowledge-map feature for server code only: reading a
// Course's map, and its build workflow.
import "server-only";

export { getKnowledgeMap } from "./server/queries";
export { buildKnowledgeMap } from "./workflows/build-knowledge-map";
