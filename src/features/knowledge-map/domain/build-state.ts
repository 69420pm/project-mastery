import type { ParseStatus } from "@/features/ingestion";
import {
  BUILD_LEASE_MINUTES,
  buildStoppedReason,
} from "@/features/knowledge-map/domain/build-failure";
import type { MapBuild } from "@/features/knowledge-map/types";

/**
 * The build the Student sees: one building without a heartbeat for
 * BUILD_LEASE_MINUTES has stopped, so it shows failed, as
 * `public.queue_knowledge_map_build` treats it.
 */
export function withBuildLease(
  build: MapBuild,
  heartbeatAt: string,
  now: number = Date.now(),
): MapBuild {
  const stale = now - Date.parse(heartbeatAt) > BUILD_LEASE_MINUTES * 60_000;
  return build?.status === "building" && stale
    ? { ...build, status: "failed", failureReason: buildStoppedReason }
    : build;
}

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
