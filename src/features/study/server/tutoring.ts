import "server-only";
import { getExamFacts } from "@/features/brief/server";
import { loadChunkSources } from "@/features/ingestion/server";
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
import { loadSchedules } from "@/features/study/server/attempts";
import { findProblems } from "@/features/study/server/find-problems";
import { isReadyProblem } from "@/features/study/server/problems";
import { kcState, utcDay } from "@/features/study/domain/replay";
import { mathRunner } from "@/features/study/server/math-runner";
import { appendMemory, loadMemory } from "@/features/study/server/memory";
import {
  findSessionQuestion,
  insertQuestion,
  loadSessionId,
  saveAttempts,
} from "@/features/study/server/questions";
import { loadMockReview } from "@/features/study/server/mock-results";
import { loadReviewQueue } from "@/features/study/server/review-queue";
import { getSessionEnd } from "@/features/study/server/sessions";
import { loadPlan } from "@/features/study/server/plan";
import { selectPracticeKcs } from "@/features/study/domain/practice";
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
import type { TutorContext, TutorSession } from "@/features/study/types";
import {
  findCourseChunk,
  insertMapFinding,
  loadMapFindingsByKc,
} from "@/features/study/server/map-findings";
import { queueProblemGeneration } from "@/features/study/server/problem-generation";
import { searchChunks } from "@/features/study/server/search";
import { tutorToday } from "@/features/study/server/tutor-today";
import {
  loadReservedChunks,
  withoutReserved,
  withoutReservedSections,
} from "@/features/study/server/reserved-exam";
import { readingLabel, sourceView } from "@/features/study/server/source-view";
import type { Supabase } from "@/lib/supabase/types";

type KnowledgeMap = Awaited<ReturnType<typeof loadStoredMap>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The most source chunks `getTopic` gives per KC. */
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
  const [
    storedMap,
    priorities,
    memory,
    exam,
    storedReadings,
    topics,
    session,
    reserved,
  ] = await Promise.all([
    loadStoredMap(supabase, courseId),
    loadKcPriorities(supabase, courseId),
    loadMemory(supabase, courseId),
    getExamFacts(supabase, courseId),
    loadStoredReadingSections(supabase, courseId),
    loadStoredTopics(supabase, courseId),
    loadStageSession(supabase, chatId),
    loadReservedChunks(supabase, courseId),
  ]);
  // The reserved exam stays unseen: the tutor never gets its chunks.
  const map = withoutReserved(storedMap, reserved);
  const readings = withoutReservedSections(storedReadings, reserved);
  const { examDate } = exam;
  const facts = { examDate, goal: exam.goal, priorities };
  const now = new Date();
  const schedules = await loadSchedules(supabase, courseId, facts, now);
  // Each KC's first Topic, which a due review names for `getTopic`.
  const topicOf = new Map<string, string>();
  for (const topic of topics) {
    for (const kcId of topic.kcs) {
      if (!topicOf.has(kcId)) topicOf.set(kcId, topic.id);
    }
  }
  const due = selectDueReviews(
    map.kcs,
    schedules,
    priorities,
    now,
    [],
    topicOf,
  );
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
  // Only learn sessions get a Topic and stages.
  const staged =
    session?.mode === "learn"
      ? await sessionStage(supabase, {
          courseId,
          session,
          next: firstReply ? plan.today.next : null,
          topics,
          reviewsDue: dueCount > 0,
          now,
        })
      : null;
  const next = staged?.topic ?? plan.today.next;
  const review = session?.mode === "review";
  const reviewQueue =
    review && session
      ? await loadReviewQueue(supabase, {
          courseId,
          session,
          map,
          topicOf,
          facts,
          minutesPerReview: plan.pace.minutesPerReview,
          now,
        })
      : null;
  const practiceKcs =
    session?.mode === "practice"
      ? selectPracticeKcs({
          kcs: map.kcs,
          topics: plan.topics.map((t) => ({
            id: t.id,
            kcs: topics.find(({ id }) => id === t.id)?.kcs ?? [],
            status: t.status,
            state: t.topicState.state,
          })),
          schedules,
          priorities,
          now,
        })
      : null;
  // A results session goes through its graded Mock exam.
  const resultsSession = session?.mode === "results";
  const mockResults =
    resultsSession && session.mockId
      ? await loadMockReview(supabase, courseId, session.mockId, map.kcs)
      : null;
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
            topicOf,
          )
        : due,
      todayPlan: tutorToday(plan, next, map, schedules, readings),
      session: staged?.session ?? null,
      ...(reviewQueue && { reviewQueue }),
      ...(practiceKcs && { practiceKcs }),
      ...(mockResults && { mockResults }),
    },
    tools: tutorTools(
      tutorToolActions(supabase, {
        courseId,
        chatId,
        facts,
        map,
        topics,
        readings,
        reserved,
        review,
        resultsSession,
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
    courseId,
    session,
    next,
    topics,
    reviewsDue,
    now,
  }: {
    courseId: string;
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
    // Topic stock: the Topic's Problems are generated in the background.
    await queueProblemGeneration(supabase, courseId, topicId);
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

function tutorToolActions(
  supabase: Supabase,
  {
    courseId,
    chatId,
    facts,
    map,
    topics,
    readings,
    reserved,
    review,
    resultsSession,
    staged,
  }: {
    courseId: string;
    chatId: string;
    facts: Parameters<typeof loadSchedules>[2];
    map: KnowledgeMap;
    topics: Awaited<ReturnType<typeof loadStoredTopics>>;
    readings: Awaited<ReturnType<typeof loadStoredReadingSections>>;
    /** The reserved exam's chunks, which no tool gives the AI. */
    reserved: Set<string>;
    /** Whether the session is a review session, which sets `findProblems`' purpose. */
    review: boolean;
    /** Whether the session is a results session, whose attempts are `retry`. */
    resultsSession: boolean;
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
  const sourceOf = (chunk: Parameters<typeof sourceView>[1]) =>
    sourceView(courseId, chunk);
  return {
    async searchMaterials(query) {
      return (await searchChunks(supabase, courseId, query, reserved)).map(
        sourceOf,
      );
    },
    isKc: (kcId) => kcById.has(kcId),
    findChunk: (chunkId) => findCourseChunk(supabase, courseId, chunkId),
    async saveMapFinding(finding) {
      const sessionId = await session();
      return insertMapFinding(supabase, { ...finding, courseId, sessionId });
    },
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
    async findProblems(kcIds) {
      requireKnown(kcIds);
      return findProblems(supabase, courseId, map, kcIds, { review });
    },
    async ask({ kcIds, problemId, ...question }) {
      requireKnown(kcIds);
      // An Exercise of the map, or else a ready generated Problem.
      const exerciseId =
        problemId !== null && map.exercises.some(({ id }) => id === problemId)
          ? problemId
          : null;
      const generatedProblemId =
        problemId !== null &&
        exerciseId === null &&
        (await isReadyProblem(supabase, courseId, problemId))
          ? problemId
          : null;
      if (problemId !== null && exerciseId === null && !generatedProblemId) {
        throw new TutorToolError(
          `${problemId} is no Problem id of this Course: use an id from findProblems, or omit it.`,
        );
      }
      const questionId = await insertQuestion(supabase, {
        ...question,
        sessionId: await session(),
        kcIds,
        exerciseId,
        problemId: generatedProblemId,
      });
      return { questionId, generatedProblemId };
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
        // A Results session's questions retry corrected KCs: never scheduled.
        kind: resultsSession ? "retry" : kind,
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
    compute: (program) => mathRunner.run(program),
    async findReading(sectionId) {
      // Ids the model made up are no uuids, which the query would refuse.
      if (!UUID.test(sectionId)) return null;
      const section = await findReadingSection(supabase, courseId, sectionId);
      if (!section || section.chunkIds.some((id) => reserved.has(id))) {
        return null;
      }
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
    async getTopic(topicId, kcIds) {
      const topic =
        topicId === null ? null : topics.find(({ id }) => id === topicId);
      if (topic === undefined) return null;
      if (!topic) requireKnown(kcIds ?? []);
      const foreign = (kcIds ?? []).filter((id) => !topic?.kcs.includes(id));
      if (topic && foreign.length > 0) {
        throw new TutorToolError(
          `These KCs are not in this Topic: ${foreign.join(", ")}. Use the ids of its KCs.`,
        );
      }
      const sectionList = topic ? (readings.get(topic.id) ?? []) : [];
      const now = new Date();
      const [schedules, done, findings] = await Promise.all([
        loadSchedules(supabase, courseId, facts, now),
        loadDoneSections(
          supabase,
          sectionList.map(({ id }) => id),
        ),
        loadMapFindingsByKc(
          supabase,
          courseId,
          (id) => kcById.get(id)?.name ?? id,
        ),
      ]);
      const stateOf = (id: string) => kcState(schedules.get(id), now).state;
      const wanted = new Set(kcIds ?? topic?.kcs);
      const ids = topic?.kcs ?? [...wanted];
      const kcs = ids.flatMap((id) => kcById.get(id) ?? []);
      const chunks = await loadChunkSources(
        supabase,
        kcs
          .filter((kc) => wanted.has(kc.id))
          .flatMap((kc) => kc.sources)
          .filter((id) => !reserved.has(id)),
      );
      return {
        id: topic?.id ?? null,
        name: topic?.name ?? null,
        centralQuestion: topic?.centralQuestion ?? null,
        kcs: kcs.map((kc) => ({
          id: kc.id,
          name: kc.name,
          type: kc.type,
          description: kc.description,
          state: stateOf(kc.id),
          sources: wanted.has(kc.id)
            ? chunks
                .filter((chunk) => kc.sources.includes(chunk.id))
                .slice(0, SOURCES_PER_KC)
                .map(sourceOf)
            : [],
          findings: findings.get(kc.id) ?? [],
        })),
        anchors:
          topic &&
          topicAnchors(topic.kcs, map).map((kc) => ({
            ...kc,
            state: stateOf(kc.id),
          })),
        readingSections:
          topic &&
          sectionList.map((section) => ({
            id: section.id,
            label: readingLabel(section),
            mode: section.mode,
            done: done.has(section.id),
          })),
      };
    },
  };
}
