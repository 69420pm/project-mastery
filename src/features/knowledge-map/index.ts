// Public API of the knowledge-map feature for any code, client or server.
// Server-only exports live in `server.ts`. It reads chunks and Materials
// through the ingestion and courses features, which never import it.
export { KnowledgeMap } from "./components/knowledge-map";
export { KnowledgeMapLink } from "./components/knowledge-map-link";
export { knowledgeMapPath } from "./domain/map-paths";
export { startKnowledgeMapBuild } from "./server/actions";
export type { KnowledgeMapView } from "./types";
