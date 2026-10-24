import "server-only";
import { getExamFacts } from "@/features/brief/server";
import { materialChunksPath } from "@/features/courses/server";
import {
  chunkAnchor,
  loadChunkSources,
  loadExerciseSolutions,
} from "@/features/ingestion/server";
import { courseMapPath, loadStoredMap } from "@/features/knowledge-map/server";
import { loadKcPriorities } from "@/features/priorities/server";
import {
  TutorToolError,
  tutorTools,
  type TutorToolActions,
  type TutorTools,
} from "@/features/study/ai/tools";
import { selectCandidates } from "@/features/study/domain/candidates";
import {
  loadAttemptedExercises,
  loadSchedules,
} from "@/features/study/server/attempts";
import {
  rankExercises,
  solutionLabel,
} from "@/features/study/domain/exercises";
import { kcState, utcDay } from "@/features/study/domain/replay";
import { appendMemory, loadMemory } from "@/features/study/server/memory";
import {
  findSessionQuestion,
  insertQuestion,
  loadSessionId,
  saveAttempts,
} from "@/features/study/server/questions";
import { getSessionEnd } from "@/features/study/server/sessions";
import { planStudy } from "@/features/study/domain/plan";
import { selectDueReviews } from "@/features/study/domain/reviews";
import type { TutorContext } from "@/features/study/types";
import type { Supabase } from "@/lib/supabase/types";

type KnowledgeMap = Awaited<ReturnType<typeof loadStoredMap>>;

/** The most source chunks `readKcs` gives per KC. */
const SOURCES_PER_KC = 3;

/**
 * What the AI tutors a reply in a Course's Chat with, read with `supabase`,
 * the Student's session client: the tutor context for its instructions and
 * its tools, which ask and grade questions in the Chat's Study session.
 * Read on every reply, so both are current.
 */
export async function startTutoring(
  supabase: Supabase,
  courseId: string,
  chatId: string,
): Promise<{ context: TutorContext; tools: TutorTools }> {
  const [map, priorities, memory, exam] = await Promise.all([
    loadStoredMap(supabase, courseId),
    loadKcPriorities(supabase, courseId),
    loadMemory(supabase, courseId),
    getExamFacts(supabase, courseId),
  ]);
  const { examDate } = exam;
  const facts = { examDate, goal: exam.goal, priorities };
  const now = new Date();
  const schedules = await loadSchedules(supabase, courseId, facts, now);
  const hasMap = map.kcs.length > 0;
  const today = utcDay(now);
  const taught = new Set(schedules.keys());
  const { phase, pacing } = planStudy({
    kcs: map.kcs,
    priorities,
    taught,
    exam,
    today,
  });
  return {
    context: {
      today,
      examDate,
      hasMap,
      phase,
      share: pacing?.share ?? null,
      leftOutCount: pacing?.leftOut.length ?? null,
      goal: exam.goal,
      memory,
      mapPath: courseMapPath(courseId),
      dueReviews: selectDueReviews(map.kcs, schedules, priorities, now),
      candidates: hasMap ? selectCandidates(map, priorities, taught) : [],
    },
    tools: tutorTools(
      tutorToolActions(supabase, { courseId, chatId, facts, map }),
    ),
  };
}

const pagesLabel = (from: number, to: number) =>
  from === to ? `p. ${from}` : `pp. ${from}–${to}`;

function tutorToolActions(
  supabase: Supabase,
  {
    courseId,
    chatId,
    facts,
    map,
  }: {
    courseId: string;
    chatId: string;
    facts: Parameters<typeof loadSchedules>[2];
    map: KnowledgeMap;
  },
): TutorToolActions {
  const kcById = new Map(map.kcs.map((kc) => [kc.id, kc]));
  // The Chat's session, read once per reply when a question needs it.
  let sessionId: Promise<string | null> | undefined;
  const session = async () => {
    sessionId ??= loadSessionId(supabase, chatId);
    const id = await sessionId;
    if (id === null) {
      throw new TutorToolError("This Chat has no Study session yet.");
    }
    return id;
  };
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
      const attempted = await loadAttemptedExercises(supabase, courseId);
      const testing = map.exercises.filter((exercise) =>
        exercise.kcs.some((id) => kcIds.includes(id)),
      );
      const unseen = testing.filter(({ id }) => !attempted.has(id));
      if (unseen.length === 0) {
        return {
          exercises: [],
          note:
            testing.length === 0
              ? "This Course has no Exercises for these KCs: pose a problem of your own."
              : "The Student has tried every Exercise of this Course for these KCs: pose a problem of your own.",
        };
      }
      const [paired, questionChunks] = await Promise.all([
        loadExerciseSolutions(supabase, courseId),
        loadChunkSources(
          supabase,
          unseen.map((exercise) => exercise.questionChunk),
        ),
      ]);
      const question = new Map(questionChunks.map((c) => [c.id, c]));
      const found = rankExercises(
        unseen.flatMap((exercise) => {
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
      const exercises = found.map((exercise) => {
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
      return { exercises };
    },
    async ask({ kcIds, exerciseId, ...question }) {
      requireKnown(kcIds);
      if (
        exerciseId !== null &&
        !map.exercises.some(({ id }) => id === exerciseId)
      ) {
        throw new TutorToolError(
          `${exerciseId} is no Exercise id of this Course: use an id from findExercises, or omit it.`,
        );
      }
      return insertQuestion(supabase, {
        ...question,
        sessionId: await session(),
        kcIds,
        exerciseId,
      });
    },
    async findQuestion(questionId) {
      const [question, end] = await Promise.all([
        findSessionQuestion(supabase, await session(), questionId),
        getSessionEnd(supabase, chatId),
      ]);
      return question && { ...question, sessionEnded: end !== null };
    },
    async saveGrade({ questionId, kind, help, results, check }) {
      const saved = await saveAttempts(supabase, {
        questionId,
        sessionId: await session(),
        kind,
        help,
        results,
        check,
      });
      if (!saved) return null;
      // The whole Course, since the final-week sweep ranks all its cards.
      const now = new Date();
      const schedules = await loadSchedules(supabase, courseId, facts, now);
      return results.map(({ kcId, result }) => ({
        id: kcId,
        name: kcById.get(kcId)?.name ?? kcId,
        result,
        ...kcState(schedules.get(kcId), now),
      }));
    },
    async remember(text) {
      if (!(await appendMemory(supabase, courseId, text))) {
        throw new TutorToolError(
          "Memory is full: the Student can tidy it on the Brief page.",
        );
      }
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
