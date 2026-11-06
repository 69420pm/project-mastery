import "server-only";
import { getBriefNotes, getExamFacts } from "@/features/brief/server";
import { loadChunkSources } from "@/features/ingestion/server";
import {
  loadReadingSections,
  loadStoredMap,
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
import { loadMaterialNotes } from "@/features/study/server/notes";
import { getSessionEnd } from "@/features/study/server/sessions";
import type { TutorContext } from "@/features/study/types";
import { searchChunks } from "@/features/study/server/search";
import {
  loadReservedChunks,
  withoutReserved,
  withoutReservedSections,
} from "@/features/study/server/reserved-exam";
import { readingLabel, sourceView } from "@/features/study/server/source-view";
import type { Supabase } from "@/lib/supabase/types";

type KnowledgeMap = Awaited<ReturnType<typeof loadStoredMap>>;

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
): Promise<{ context: TutorContext; tools: TutorTools }> {
  const [
    storedMap,
    priorities,
    memory,
    exam,
    storedReadings,
    topics,
    reserved,
    briefNotes,
    materialNotes,
  ] = await Promise.all([
    loadStoredMap(supabase, courseId),
    loadKcPriorities(supabase, courseId),
    loadMemory(supabase, courseId),
    getExamFacts(supabase, courseId),
    loadReadingSections(supabase, courseId),
    loadStoredTopics(supabase, courseId),
    loadReservedChunks(supabase, courseId),
    getBriefNotes(supabase, courseId),
    loadMaterialNotes(supabase, courseId),
  ]);
  // The reserved exam stays unseen: the tutor never gets its chunks.
  const map = withoutReserved(storedMap, reserved);
  const readings = withoutReservedSections(storedReadings, reserved);
  return {
    context: {
      today: utcDay(new Date()),
      examDate: exam.examDate,
      goal: exam.goal,
      memory,
      briefNotes: briefNotes === null ? null : briefNotes.slice(-4000),
      materialNotes,
    },
    tools: tutorTools(
      tutorToolActions(supabase, {
        courseId,
        chatId,
        facts: { examDate: exam.examDate, goal: exam.goal, priorities },
        map,
        topics,
        readings,
        reserved,
      }),
    ),
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
  }: {
    courseId: string;
    chatId: string;
    facts: Parameters<typeof loadSchedules>[2];
    map: KnowledgeMap;
    topics: Awaited<ReturnType<typeof loadStoredTopics>>;
    readings: Awaited<ReturnType<typeof loadReadingSections>>;
    /** The reserved exam's chunks, which no tool gives the AI. */
    reserved: Set<string>;
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
        `These are no KC ids of this Course: ${unknown.join(", ")}. Use the KC ids that getTopic returns.`,
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
    async findProblems(kcIds) {
      requireKnown(kcIds);
      return findProblems(supabase, courseId, map, kcIds);
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
    async saveGrade({ questionId, help, results, check }) {
      const saved = await saveAttempts(supabase, {
        questionId,
        sessionId: await session(),
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
      // `readings` leaves out the reserved exam's sections.
      const section = [...readings.values()]
        .flat()
        .find(({ id }) => id === sectionId);
      if (!section) return null;
      const chunks = await loadChunkSources(supabase, section.chunkIds);
      return {
        label: readingLabel(section),
        chunks: chunks.map((chunk) => chunk.markdown),
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
      const now = new Date();
      const schedules = await loadSchedules(supabase, courseId, facts, now);
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
          description: kc.description,
          state: stateOf(kc.id),
          sources: wanted.has(kc.id)
            ? chunks
                .filter((chunk) => kc.sources.includes(chunk.id))
                .slice(0, SOURCES_PER_KC)
                .map(sourceOf)
            : [],
        })),
        anchors:
          topic &&
          topicAnchors(topic.kcs, map).map((kc) => ({
            ...kc,
            state: stateOf(kc.id),
          })),
        readingSections:
          topic &&
          (readings.get(topic.id) ?? []).map((section) => ({
            id: section.id,
            label: readingLabel(section),
          })),
      };
    },
  };
}
