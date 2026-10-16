import "server-only";
import { getExamDate } from "@/features/brief/server";
import { materialChunksPath } from "@/features/courses/server";
import {
  chunkAnchor,
  loadChunkSources,
  loadExerciseSolutions,
} from "@/features/ingestion/server";
import {
  knowledgeMapPath,
  loadStoredMap,
} from "@/features/knowledge-map/server";
import { loadKcPriorities } from "@/features/priorities/server";
import {
  TutorToolError,
  tutorTools,
  type TutorToolActions,
  type TutorTools,
} from "@/features/study/ai/tools";
import { selectCandidates } from "@/features/study/domain/candidates";
import { insertAttempts, loadLadder } from "@/features/study/server/attempts";
import {
  rankExercises,
  solutionLabel,
} from "@/features/study/domain/exercises";
import type { TutorContext } from "@/features/study/types";
import type { Supabase } from "@/lib/supabase/types";

type KnowledgeMap = Awaited<ReturnType<typeof loadStoredMap>>;

/** The most source chunks `readKcs` gives per KC. */
const SOURCES_PER_KC = 3;

/**
 * What the AI tutors a reply in a Course's Chat with, read with `supabase`,
 * the Student's session client: the tutor context for its instructions and
 * its tools. Read on every reply, so both are current.
 */
export async function startTutoring(
  supabase: Supabase,
  courseId: string,
): Promise<{ context: TutorContext; tools: TutorTools }> {
  const [map, priorities, examDate] = await Promise.all([
    loadStoredMap(supabase, courseId),
    loadKcPriorities(supabase, courseId),
    getExamDate(supabase, courseId),
  ]);
  const hasMap = map.kcs.length > 0;
  return {
    context: {
      today: new Date().toISOString().slice(0, 10),
      examDate,
      hasMap,
      mapPath: knowledgeMapPath(courseId),
      candidates: hasMap ? selectCandidates(map, priorities) : [],
    },
    tools: tutorTools(tutorToolActions(supabase, courseId, map, examDate)),
  };
}

const pagesLabel = (from: number, to: number) =>
  from === to ? `p. ${from}` : `pp. ${from}–${to}`;

function tutorToolActions(
  supabase: Supabase,
  courseId: string,
  map: KnowledgeMap,
  examDate: string | null,
): TutorToolActions {
  const kcById = new Map(map.kcs.map((kc) => [kc.id, kc]));
  const exerciseIds = new Set(map.exercises.map((exercise) => exercise.id));
  const requireKnown = (kcIds: string[]) => {
    const unknown = kcIds.filter((id) => !kcById.has(id));
    if (unknown.length > 0) {
      throw new TutorToolError(
        `These are no KC ids of this Course: ${unknown.join(", ")}. Use the ids of the candidates and their anchors.`,
      );
    }
  };
  const linkTo = (chunk: { id: string; materialId: string }) =>
    `${materialChunksPath(courseId, chunk.materialId)}#${chunkAnchor(chunk.id)}`;
  return {
    async findExercises(kcIds) {
      requireKnown(kcIds);
      const [paired, questionChunks] = await Promise.all([
        loadExerciseSolutions(supabase, courseId),
        loadChunkSources(
          supabase,
          map.exercises.map((exercise) => exercise.questionChunk),
        ),
      ]);
      const question = new Map(questionChunks.map((c) => [c.id, c]));
      const found = rankExercises(
        map.exercises.flatMap((exercise) => {
          const chunk = question.get(exercise.questionChunk);
          return chunk ? [{ ...exercise, chunk, oldExam: chunk.isExam }] : [];
        }),
        kcIds,
      );
      const solutionIds = found.flatMap(
        (exercise) => paired[exercise.questionChunk] ?? [],
      );
      const solutions = new Map(
        (await loadChunkSources(supabase, solutionIds)).map((c) => [c.id, c]),
      );
      return found.map((exercise) => {
        const solutionChunk = solutions.get(
          paired[exercise.questionChunk] ?? "",
        );
        return {
          id: exercise.id,
          name: exercise.name,
          taskType: exercise.taskType,
          difficulty: exercise.difficulty,
          question: exercise.chunk.markdown,
          link: linkTo(exercise.chunk),
          kcs: exercise.kcs.map((id) => ({ id, name: kcById.get(id)!.name })),
          solution: {
            status: solutionLabel(exercise.solutionStatus),
            markdown: exercise.solution ?? solutionChunk?.markdown ?? null,
          },
        };
      });
    },
    async recordAttempt(attempt) {
      const kcIds = attempt.kcs.map(({ kcId }) => kcId);
      requireKnown(kcIds);
      if (new Set(kcIds).size < kcIds.length) {
        throw new TutorToolError("List each KC once.");
      }
      const { exerciseId } = attempt;
      if (exerciseId !== undefined && !exerciseIds.has(exerciseId)) {
        throw new TutorToolError(
          `${exerciseId} is no Exercise id of this Course: use an id from findExercises, or omit it.`,
        );
      }
      await insertAttempts(supabase, courseId, attempt);
      const ladder = await loadLadder(supabase, courseId, examDate, kcIds);
      return kcIds.map((id) => ({
        id,
        name: kcById.get(id)!.name,
        ...ladder.get(id)!,
      }));
    },
    async readKcs(kcIds) {
      requireKnown(kcIds);
      const kcs = [...new Set(kcIds)].map((id) => kcById.get(id)!);
      const chunks = await loadChunkSources(
        supabase,
        kcs.flatMap((kc) => kc.sources),
      );
      return kcs.map((kc) => ({
        id: kc.id,
        name: kc.name,
        type: kc.type,
        description: kc.description,
        sources: chunks
          .filter((chunk) => kc.sources.includes(chunk.id))
          .slice(0, SOURCES_PER_KC)
          .map((chunk) => ({
            material: chunk.materialName,
            pages: pagesLabel(chunk.pageFrom, chunk.pageTo),
            link: linkTo(chunk),
            markdown: chunk.markdown,
          })),
      }));
    },
  };
}
