import "server-only";
import { z } from "zod";
import { getMaterialList } from "@/features/courses/server";
import { getChunkPlaces } from "@/features/ingestion/server";
import { canBuildMap } from "@/features/knowledge-map/domain/build-state";
import { BLOOM_LEVELS, KC_TYPES } from "@/features/knowledge-map/schemas";
import type {
  KnowledgeMapView,
  MapBuild,
} from "@/features/knowledge-map/types";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

function failed(action: string, error: { message: string }): never {
  throw new Error(`${action} failed: ${error.message}`);
}

const buildStatus = z.enum(["building", "built", "failed"]);

/**
 * The signed-in Student's Knowledge map of a Course, with its build state
 * and whether Build may start. Row Level Security scopes every read; an
 * unknown or another Student's Course reads as an empty, never built map.
 */
export async function getKnowledgeMap(
  courseId: string,
): Promise<KnowledgeMapView> {
  const empty: KnowledgeMapView = {
    courseId,
    build: null,
    bigIdeas: [],
    canBuild: false,
  };
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) {
    return empty;
  }
  const supabase = await createClient();

  const [build, bigIdeas, kcs, sources, materials] = await Promise.all([
    supabase
      .from("knowledge_map_builds")
      .select("status, failure_reason, finished_at")
      .eq("course_id", courseId)
      .maybeSingle(),
    supabase
      .from("big_ideas")
      .select("id, name, description")
      .eq("course_id", courseId)
      .order("position"),
    supabase
      .from("kcs")
      .select("id, big_idea_id, name, description, type, bloom")
      .eq("course_id", courseId)
      .order("position"),
    supabase
      .from("kc_sources")
      .select("kc_id, chunk_id")
      .eq("course_id", courseId),
    getMaterialList(courseId),
  ]);
  if (build.error) failed("Loading the build", build.error);
  if (bigIdeas.error) failed("Loading the big ideas", bigIdeas.error);
  if (kcs.error) failed("Loading the KCs", kcs.error);
  if (sources.error) failed("Loading the KC sources", sources.error);

  const places = await getChunkPlaces([
    ...new Set(sources.data.map((source) => source.chunk_id)),
  ]);
  // The list is newest first; sources go in reading order, oldest first.
  const materialOrder = new Map(
    materials.map((material, index) => [material.id, -index]),
  );
  const materialName = new Map(materials.map((m) => [m.id, m.name]));
  const sourcesOf = (kcId: string) =>
    sources.data
      .filter((source) => source.kc_id === kcId)
      .flatMap((source) => places.filter((p) => p.id === source.chunk_id))
      .toSorted(
        (a, b) =>
          (materialOrder.get(a.materialId) ?? 0) -
            (materialOrder.get(b.materialId) ?? 0) || a.position - b.position,
      )
      .map(
        (place) =>
          `${materialName.get(place.materialId) ?? "Material"} p. ${place.pageFrom}`,
      );

  const mapBuild: MapBuild = build.data && {
    status: buildStatus.parse(build.data.status),
    failureReason: build.data.failure_reason,
    finishedAt: build.data.finished_at,
  };
  return {
    courseId,
    build: mapBuild,
    canBuild: canBuildMap(
      materials.map((material) => material.parse.status),
      mapBuild,
    ),
    bigIdeas: bigIdeas.data.map((bigIdea) => ({
      ...bigIdea,
      kcs: kcs.data
        .filter((kc) => kc.big_idea_id === bigIdea.id)
        .map((kc) => ({
          id: kc.id,
          name: kc.name,
          description: kc.description,
          type: z.enum(KC_TYPES).parse(kc.type),
          bloom: z.enum(BLOOM_LEVELS).nullable().parse(kc.bloom),
          // One entry per page, for KCs taught by several chunks of it.
          sources: [...new Set(sourcesOf(kc.id))],
        })),
    })),
  };
}
