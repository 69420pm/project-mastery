import type { ParseStatus } from "@/features/ingestion";
import type { MapBuild } from "@/features/knowledge-map/types";

/**
 * Whether the Student may start a build: none runs, at least one Material
 * is parsed and none is queued or parsing. The same rule guards
 * `public.queue_knowledge_map_build`.
 */
export function canBuildMap(
  parseStatuses: ParseStatus[],
  build: MapBuild,
): boolean {
  return (
    build?.status !== "building" &&
    parseStatuses.includes("parsed") &&
    !parseStatuses.some((status) => status === "queued" || status === "parsing")
  );
}
