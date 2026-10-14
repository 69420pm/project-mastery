import "server-only";
import { z } from "zod";
import { getMaterialList } from "@/features/courses/server";
import { getChunkPlaces } from "@/features/ingestion/server";
import { canBuildMap } from "@/features/knowledge-map/domain/build-state";
import {
  BLOOM_LEVELS,
  checkReportSchema,
  KC_TYPES,
  SEMANTIC_LINK_TYPES,
  SOLUTION_STATUSES,
} from "@/features/knowledge-map/schemas";
import type {
  KcView,
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
    priorKnowledge: [],
    semanticLinks: [],
    exercises: [],
    findings: [],
    checkReport: null,
    canBuild: false,
  };
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) {
    return empty;
  }
  const supabase = await createClient();

  const [
    build,
    bigIdeas,
    kcs,
    sources,
    prerequisites,
    semantic,
    materials,
    exercises,
    exerciseKcs,
    findings,
    findingSources,
  ] = await Promise.all([
    supabase
      .from("knowledge_map_builds")
      .select("status, failure_reason, finished_at, check_report")
      .eq("course_id", courseId)
      .maybeSingle(),
    supabase
      .from("big_ideas")
      .select("id, name, description")
      .eq("course_id", courseId)
      .order("position"),
    supabase
      .from("kcs")
      .select("id, big_idea_id, name, description, type, bloom, origin")
      .eq("course_id", courseId)
      .order("position"),
    supabase
      .from("kc_sources")
      .select("kc_id, chunk_id")
      .eq("course_id", courseId),
    supabase
      .from("prerequisite_links")
      .select("from_kc, to_kc")
      .eq("course_id", courseId),
    supabase
      .from("semantic_links")
      .select("from_kc, to_kc, core_type, label")
      .eq("course_id", courseId),
    getMaterialList(courseId),
    supabase
      .from("exercises")
      .select("id, name, task_type, solution_status, difficulty")
      .eq("course_id", courseId)
      .order("position"),
    supabase
      .from("exercise_kcs")
      .select("exercise_id, kc_id")
      .eq("course_id", courseId),
    supabase
      .from("findings")
      .select("id, text")
      .eq("course_id", courseId)
      .order("position"),
    supabase
      .from("finding_sources")
      .select("finding_id, chunk_id")
      .eq("course_id", courseId),
  ]);
  if (build.error) failed("Loading the build", build.error);
  if (bigIdeas.error) failed("Loading the big ideas", bigIdeas.error);
  if (kcs.error) failed("Loading the KCs", kcs.error);
  if (sources.error) failed("Loading the KC sources", sources.error);
  if (prerequisites.error) {
    failed("Loading the prerequisites", prerequisites.error);
  }
  if (semantic.error) failed("Loading the semantic links", semantic.error);
  if (exercises.error) failed("Loading the exercises", exercises.error);
  if (exerciseKcs.error) failed("Loading the exercise KCs", exerciseKcs.error);
  if (findings.error) failed("Loading the findings", findings.error);
  if (findingSources.error) {
    failed("Loading the finding sources", findingSources.error);
  }

  const report = checkReportSchema
    .nullable()
    .parse(build.data?.check_report ?? null);
  const places = await getChunkPlaces([
    ...new Set([
      ...sources.data.map((source) => source.chunk_id),
      ...(report?.uncoveredChunkIds ?? []),
      ...findingSources.data.map((source) => source.chunk_id),
    ]),
  ]);
  // The list is newest first; places go in reading order, oldest first.
  const materialOrder = new Map(
    materials.map((material, index) => [material.id, -index]),
  );
  const materialName = new Map(materials.map((m) => [m.id, m.name]));
  /** The pages of these chunks in reading order, each page once. */
  const pagesOf = (chunkIds: string[]) => [
    ...new Set(
      places
        .filter((place) => chunkIds.includes(place.id))
        .toSorted(
          (a, b) =>
            (materialOrder.get(a.materialId) ?? 0) -
              (materialOrder.get(b.materialId) ?? 0) || a.position - b.position,
        )
        .map(
          (place) =>
            `${materialName.get(place.materialId) ?? "Material"} p. ${place.pageFrom}`,
        ),
    ),
  ];

  const kcName = new Map(kcs.data.map((kc) => [kc.id, kc.name]));
  const kcView = (kc: (typeof kcs.data)[number]): KcView => ({
    id: kc.id,
    name: kc.name,
    description: kc.description,
    type: z.enum(KC_TYPES).parse(kc.type),
    bloom: z.enum(BLOOM_LEVELS).nullable().parse(kc.bloom),
    fromExercise: kc.origin === "exercise",
    sources: pagesOf(
      sources.data
        .filter((source) => source.kc_id === kc.id)
        .map((source) => source.chunk_id),
    ),
    prerequisites: prerequisites.data
      .filter((link) => link.to_kc === kc.id)
      .map((link) => kcName.get(link.from_kc) ?? "")
      .toSorted(),
  });

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
      kcs: kcs.data.filter((kc) => kc.big_idea_id === bigIdea.id).map(kcView),
    })),
    priorKnowledge: kcs.data
      .filter((kc) => kc.big_idea_id === null)
      .map(kcView),
    semanticLinks: semantic.data.map((link) => ({
      from: kcName.get(link.from_kc) ?? "",
      to: kcName.get(link.to_kc) ?? "",
      coreType: z.enum(SEMANTIC_LINK_TYPES).parse(link.core_type),
      label: link.label,
    })),
    exercises: exercises.data.map((exercise) => {
      const tested = new Set(
        exerciseKcs.data
          .filter((link) => link.exercise_id === exercise.id)
          .map((link) => link.kc_id),
      );
      return {
        id: exercise.id,
        name: exercise.name,
        taskType: exercise.task_type,
        kcs: kcs.data.filter((kc) => tested.has(kc.id)).map((kc) => kc.name),
        solutionStatus: z
          .enum(SOLUTION_STATUSES)
          .parse(exercise.solution_status),
        difficulty: z
          .union([z.literal(1), z.literal(2), z.literal(3)])
          .parse(exercise.difficulty),
      };
    }),
    findings: findings.data.map((finding) => ({
      id: finding.id,
      text: finding.text,
      sources: pagesOf(
        findingSources.data
          .filter((source) => source.finding_id === finding.id)
          .map((source) => source.chunk_id),
      ),
    })),
    checkReport: report && {
      uncoveredChunks: pagesOf(report.uncoveredChunkIds),
      ungroundedKcs: report.ungroundedKcs,
      orphanKcs: report.orphanKcs,
      droppedCycleEdges: report.droppedCycleEdges,
      unmappedExercises: report.unmappedExercises,
      untestedKcs: report.untestedKcs,
      duplicates: report.duplicates,
    },
  };
}
