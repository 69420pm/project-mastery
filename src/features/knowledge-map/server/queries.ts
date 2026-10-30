import "server-only";
import { z } from "zod";
import { getMaterialList, materialChunksPath } from "@/features/courses/server";
import {
  chunkAnchor,
  loadChunkSources,
  loadExerciseSolutions,
} from "@/features/ingestion/server";
import {
  canBuildMap,
  withBuildLease,
} from "@/features/knowledge-map/domain/build-state";
import { checkReportSchema, KC_TYPES } from "@/features/knowledge-map/schemas";
import type {
  KcSourceView,
  KcView,
  KnowledgeMapView,
  MapBuild,
} from "@/features/knowledge-map/types";
import { getUser } from "@/lib/auth/user";
import { allRows } from "@/lib/supabase/all-rows";
import { failed } from "@/lib/supabase/failed";
import { createClient } from "@/lib/supabase/server";

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
    prerequisites: [],
    exercises: [],
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
    materials,
    exercises,
    exerciseKcs,
    pairedSolutions,
  ] = await Promise.all([
    supabase
      .from("knowledge_map_builds")
      .select("status, failure_reason, finished_at, check_report, heartbeat_at")
      .eq("course_id", courseId)
      .maybeSingle(),
    supabase
      .from("big_ideas")
      .select("id, name, description")
      .eq("course_id", courseId)
      .order("position"),
    allRows("Loading the KCs", (from, to) =>
      supabase
        .from("kcs")
        .select("id, big_idea_id, name, description, type, origin")
        .eq("course_id", courseId)
        .is("retired_at", null)
        .order("position")
        .order("id")
        .range(from, to),
    ),
    allRows("Loading the KC sources", (from, to) =>
      supabase
        .from("kc_sources")
        .select("kc_id, chunk_id")
        .eq("course_id", courseId)
        .order("kc_id")
        .order("chunk_id")
        .range(from, to),
    ),
    allRows("Loading the prerequisites", (from, to) =>
      supabase
        .from("prerequisite_links")
        .select("from_kc, to_kc")
        .eq("course_id", courseId)
        .order("id")
        .range(from, to),
    ),
    getMaterialList(courseId),
    allRows("Loading the exercises", (from, to) =>
      supabase
        .from("exercises")
        .select("id, difficulty, question_chunk_id")
        .eq("course_id", courseId)
        .order("position")
        .order("id")
        .range(from, to),
    ),
    allRows("Loading the exercise KCs", (from, to) =>
      supabase
        .from("exercise_kcs")
        .select("exercise_id, kc_id")
        .eq("course_id", courseId)
        .order("exercise_id")
        .order("kc_id")
        .range(from, to),
    ),
    loadExerciseSolutions(supabase, courseId),
  ]);
  if (build.error) failed("Loading the build", build.error);
  if (bigIdeas.error) failed("Loading the big ideas", bigIdeas.error);

  const report = checkReportSchema
    .nullable()
    .parse(build.data?.check_report ?? null);
  // In reading order: Materials in upload order, chunks by position.
  const chunks = await loadChunkSources(supabase, [
    ...sources.map((source) => source.chunk_id),
    ...(report?.uncoveredChunkIds ?? []),
    ...exercises.flatMap((exercise) => {
      const solution = pairedSolutions[exercise.question_chunk_id];
      return solution
        ? [exercise.question_chunk_id, solution]
        : [exercise.question_chunk_id];
    }),
  ]);
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  /** The pages of these chunks in reading order, each page once. */
  const pagesOf = (chunkIds: string[]) => [
    ...new Set(
      chunks
        .filter((chunk) => chunkIds.includes(chunk.id))
        .map((chunk) => `${chunk.materialName} p. ${chunk.pageFrom}`),
    ),
  ];
  const sourcesOf = (kcId: string): KcSourceView[] => {
    const ids = new Set(
      sources
        .filter((source) => source.kc_id === kcId)
        .map((source) => source.chunk_id),
    );
    return chunks
      .filter((chunk) => ids.has(chunk.id))
      .map((chunk) => ({
        chunkId: chunk.id,
        material: chunk.materialName,
        pages:
          chunk.pageFrom === chunk.pageTo
            ? `p. ${chunk.pageFrom}`
            : `pp. ${chunk.pageFrom}–${chunk.pageTo}`,
        link: `${materialChunksPath(courseId, chunk.materialId)}#${chunkAnchor(chunk.id)}`,
        markdown: chunk.markdown,
      }));
  };

  const kcView = (kc: (typeof kcs)[number]): KcView => ({
    id: kc.id,
    name: kc.name,
    description: kc.description,
    type: z.enum(KC_TYPES).parse(kc.type),
    origin: z.enum(["content", "exercise"]).parse(kc.origin),
    sources: sourcesOf(kc.id),
  });

  const mapBuild: MapBuild =
    build.data &&
    withBuildLease(
      {
        status: buildStatus.parse(build.data.status),
        failureReason: build.data.failure_reason,
        finishedAt: build.data.finished_at,
      },
      build.data.heartbeat_at,
    );
  const live = new Set(kcs.map((kc) => kc.id));
  return {
    courseId,
    build: mapBuild,
    canBuild: canBuildMap(
      materials.map((material) => material.parse.status),
      mapBuild,
    ),
    bigIdeas: bigIdeas.data.map((bigIdea) => ({
      ...bigIdea,
      kcs: kcs.filter((kc) => kc.big_idea_id === bigIdea.id).map(kcView),
    })),
    // A retired KC's links wait for it to come back.
    prerequisites: prerequisites
      .filter((link) => live.has(link.from_kc) && live.has(link.to_kc))
      .map((link) => ({ from: link.from_kc, to: link.to_kc })),
    exercises: exercises.map((exercise) => {
      const tested = new Set(
        exerciseKcs
          .filter((link) => link.exercise_id === exercise.id)
          .map((link) => link.kc_id),
      );
      const question = chunkById.get(exercise.question_chunk_id);
      return {
        id: exercise.id,
        name: question
          ? `${question.materialName} p. ${question.pageFrom}`
          : "Exercise",
        kcs: kcs.filter((kc) => tested.has(kc.id)).map((kc) => kc.id),
        difficulty: z
          .union([z.literal(1), z.literal(2), z.literal(3)])
          .parse(exercise.difficulty),
        question: question?.markdown ?? null,
        // A printed solution is the question's paired chunk.
        solution:
          chunkById.get(pairedSolutions[exercise.question_chunk_id] ?? "")
            ?.markdown ?? null,
      };
    }),
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
