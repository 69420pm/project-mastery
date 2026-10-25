import "server-only";
import { getExamFacts } from "@/features/brief/server";
import { materialChunksPath } from "@/features/courses/server";
import {
  chunkAnchor,
  loadChunkSources,
  loadExerciseSolutions,
} from "@/features/ingestion/server";
import {
  courseMapPath,
  findReadingSection,
  loadStoredMap,
  loadStoredReadingSections,
  loadStoredTopics,
  topicAnchors,
} from "@/features/knowledge-map/server";
import { loadKcPriorities } from "@/features/priorities/server";
import {
  TutorToolError,
  tutorTools,
  type TutorToolActions,
  type TutorTools,
} from "@/features/study/ai/tools";
import {
  loadAttemptedExercises,
  loadSchedules,
} from "@/features/study/server/attempts";
import {
  rankExercises,
  solutionLabel,
} from "@/features/study/domain/exercises";
import { fitText } from "@/features/study/domain/plan";
import { kcState, utcDay } from "@/features/study/domain/replay";
import { appendMemory, loadMemory } from "@/features/study/server/memory";
import {
  findSessionQuestion,
  insertQuestion,
  loadSessionId,
  saveAttempts,
} from "@/features/study/server/questions";
import { getSessionEnd } from "@/features/study/server/sessions";
import { loadPlan } from "@/features/study/server/plan";
import { selectDueReviews } from "@/features/study/domain/reviews";
import {
  resumeStage,
  startStage,
  type Stage,
} from "@/features/study/domain/stages";
import type { TodayTopic } from "@/features/study/domain/today";
import {
  loadDoneSections,
  loadPreviousStage,
  loadStageSession,
  saveStage,
  startSessionTopic,
  type StageSession,
} from "@/features/study/server/stages";
import type {
  TutorContext,
  TutorSession,
  TutorToday,
} from "@/features/study/types";
import type { Supabase } from "@/lib/supabase/types";

type KnowledgeMap = Awaited<ReturnType<typeof loadStoredMap>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  {
    firstReply = false,
  }: {
    /** Whether the reply is the session's first, which sets its Topic. */
    firstReply?: boolean;
  } = {},
): Promise<{ context: TutorContext; tools: TutorTools }> {
  const [map, priorities, memory, exam, readings, topics, session] =
    await Promise.all([
      loadStoredMap(supabase, courseId),
      loadKcPriorities(supabase, courseId),
      loadMemory(supabase, courseId),
      getExamFacts(supabase, courseId),
      loadStoredReadingSections(supabase, courseId),
      loadStoredTopics(supabase, courseId),
      loadStageSession(supabase, chatId),
    ]);
  const { examDate } = exam;
  const facts = { examDate, goal: exam.goal, priorities };
  const now = new Date();
  const schedules = await loadSchedules(supabase, courseId, facts, now);
  const due = selectDueReviews(map.kcs, schedules, priorities, now);
  const dueCount = due.kcs.length + due.more;
  const plan = await loadPlan(
    supabase,
    courseId,
    {
      prerequisites: map.prerequisites,
      priorities,
      exam,
      schedules,
      dueCount,
      topics,
    },
    now,
  );
  const staged =
    session &&
    (await sessionStage(supabase, {
      session,
      next: firstReply ? plan.today.next : null,
      topics,
      reviewsDue: dueCount > 0,
      now,
    }));
  const next = staged?.topic ?? plan.today.next;
  return {
    context: {
      today: utcDay(now),
      examDate,
      hasMap: map.kcs.length > 0,
      phase: plan.phase,
      goal: exam.goal,
      memory,
      mapPath: courseMapPath(courseId),
      // The review opening prepares the docking: the Topic's anchors first.
      dueReviews: staged
        ? selectDueReviews(
            map.kcs,
            schedules,
            priorities,
            now,
            topicAnchors(staged.topic.kcs, map).map(({ id }) => id),
          )
        : due,
      todayPlan: tutorToday(plan, next, map, schedules, readings),
      session: staged?.session ?? null,
    },
    tools: tutorTools(
      tutorToolActions(supabase, {
        courseId,
        chatId,
        facts,
        map,
        staged: staged && {
          afterReview: staged.session.afterReview,
          sectionIds: (readings.get(staged.topic.id) ?? []).map(({ id }) => id),
        },
      }),
    ),
  };
}

/**
 * The session's Topic and stage. The first reply sets them, from the plan's
 * next Topic (`next`) and `startStage`; later replies read them. Null
 * without a Topic.
 */
async function sessionStage(
  supabase: Supabase,
  {
    session,
    next,
    topics,
    reviewsDue,
    now,
  }: {
    session: StageSession;
    /** The Topic to set when the session has none; null to set none. */
    next: TodayTopic | null;
    topics: Awaited<ReturnType<typeof loadStoredTopics>>;
    reviewsDue: boolean;
    now: Date;
  },
): Promise<{ topic: TodayTopic; session: TutorSession } | null> {
  const topicId = session.topicId ?? next?.id;
  if (!topicId) return null;
  const previous = await loadPreviousStage(
    supabase,
    topicId,
    session.startedAt,
  );
  let { stage } = session;
  if (session.topicId === null) {
    stage = startStage(previous, reviewsDue);
    if (!(await startSessionTopic(supabase, session.id, topicId, stage))) {
      return null;
    }
  }
  const topic = topics.find(({ id }) => id === topicId);
  if (!topic || stage === null) return null;
  return {
    topic: {
      id: topic.id,
      name: topic.name,
      centralQuestion: topic.centralQuestion,
      kcs: topic.kcs,
    },
    session: {
      stage,
      afterReview: resumeStage(previous),
      minutes: Math.floor(
        (now.getTime() - new Date(session.startedAt).getTime()) / 60_000,
      ),
    },
  };
}

/**
 * Today's work as the AI is told of it: the Topic `next` (the session's, or
 * the plan's next) with its KCs and anchors from the map and its Reading
 * sections, the hint and the fit line.
 */
function tutorToday(
  plan: Awaited<ReturnType<typeof loadPlan>>,
  next: TodayTopic | null,
  map: KnowledgeMap,
  schedules: Map<string, unknown>,
  readings: Awaited<ReturnType<typeof loadStoredReadingSections>>,
): TutorToday {
  const { hint } = plan.today;
  const kcById = new Map(map.kcs.map((kc) => [kc.id, kc]));
  return {
    next: next && {
      id: next.id,
      name: next.name,
      centralQuestion: next.centralQuestion,
      kcs: next.kcs.flatMap((id) => {
        const kc = kcById.get(id);
        return kc
          ? [{ id, name: kc.name, type: kc.type, taught: schedules.has(id) }]
          : [];
      }),
      anchors: topicAnchors(next.kcs, map),
      readingSections: (readings.get(next.id) ?? []).map((section) => ({
        id: section.id,
        label: readingLabel(section),
        mode: section.mode,
      })),
    },
    hint,
    fitLine:
      plan.phase === null || plan.fit === null
        ? null
        : fitText(plan.phase, plan.fit),
  };
}

const pagesLabel = (from: number, to: number) =>
  from === to ? `p. ${from}` : `pp. ${from}–${to}`;

/** Such as "Lecture 3, pp. 12–14". */
const readingLabel = (section: {
  materialName: string;
  pageFrom: number;
  pageTo: number;
}) =>
  `${section.materialName}, ${pagesLabel(section.pageFrom, section.pageTo)}`;

function tutorToolActions(
  supabase: Supabase,
  {
    courseId,
    chatId,
    facts,
    map,
    staged,
  }: {
    courseId: string;
    chatId: string;
    facts: Parameters<typeof loadSchedules>[2];
    map: KnowledgeMap;
    /** The session's stages; null without a Topic. */
    staged: { afterReview: Stage; sectionIds: string[] } | null;
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
        `These are no KC ids of this Course: ${unknown.join(", ")}. Use the ids of the due reviews, the next Topic's KCs and their anchors.`,
      );
    }
  };
  const linkTo = (chunk: { id: string; materialId: string }) =>
    `${materialChunksPath(courseId, chunk.materialId)}#${chunkAnchor(chunk.id)}`;
  return {
    // Read fresh on every call, as an earlier call may have moved it.
    async loadStage() {
      if (!staged) return null;
      const [current, done] = await Promise.all([
        loadStageSession(supabase, chatId),
        loadDoneSections(supabase, staged.sectionIds),
      ]);
      if (!current?.stage) return null;
      return {
        stage: current.stage,
        afterReview: staged.afterReview,
        readingLeft: staged.sectionIds.some((id) => !done.has(id)),
      };
    },
    async saveStage(stage) {
      return saveStage(supabase, await session(), stage);
    },
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
    async findReading(sectionId) {
      // Ids the model made up are no uuids, which the query would refuse.
      if (!UUID.test(sectionId)) return null;
      const section = await findReadingSection(supabase, courseId, sectionId);
      if (!section) return null;
      const chunks = await loadChunkSources(supabase, section.chunkIds);
      return {
        label: readingLabel(section),
        mode: section.mode,
        chunks: chunks.map((chunk) => chunk.markdown),
        studyText: section.studyText,
      };
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
