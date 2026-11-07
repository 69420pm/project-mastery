import "server-only";
import { loadChunkSources } from "@/features/ingestion/server";
import {
  loadKcAssumes,
  topicAnchors,
  type loadReadingSections,
  type loadStoredMap,
  type loadStoredTopics,
} from "@/features/knowledge-map/server";
import {
  TutorToolError,
  tutorTools,
  type TutorToolActions,
  type TutorTools,
} from "@/features/study/ai/tools";
import { kcBand } from "@/features/study/domain/recall-band";
import { desiredRetention } from "@/features/study/domain/replay";
import { loadRecall } from "@/features/study/server/attempts";
import { findProblems } from "@/features/study/server/find-problems";
import { mathRunner } from "@/features/study/server/math-runner";
import { appendMemory } from "@/features/study/server/memory";
import { isReadyProblem } from "@/features/study/server/problems";
import {
  closeQuestion,
  findNewestQuestion,
  insertQuestion,
  loadTutorSession,
  saveAttempts,
} from "@/features/study/server/questions";
import { searchChunks } from "@/features/study/server/search";
import { getSessionEnd } from "@/features/study/server/sessions";
import { readingLabel, sourceView } from "@/features/study/server/source-view";
import { loadTutorContext } from "@/features/study/server/tutor-context";
import type { TutorContext } from "@/features/study/types";
import type { Supabase } from "@/lib/supabase/types";

type KnowledgeMap = Awaited<ReturnType<typeof loadStoredMap>>;

/** The most source chunks `getTopic` gives per KC. */
const SOURCES_PER_KC = 3;

/**
 * What the AI tutors a reply in a Course's Chat with, read with `supabase`,
 * the Student's session client: the tutor context (#251) and the tools,
 * which ask and grade Questions in the Chat's Study session. Read on every
 * reply, so both are current. `openedSections` are the Reading sections
 * the Chat's `showReading` calls opened. On the session's first reply it
 * tops up the Problem stock of the ranking's next Topic.
 */
export async function startTutoring(
  supabase: Supabase,
  courseId: string,
  chatId: string,
  {
    openedSections,
    firstReply,
  }: { openedSections: string[]; firstReply: boolean },
): Promise<{ context: TutorContext; tools: TutorTools }> {
  const session = await loadTutorSession(supabase, chatId);
  const loaded = await loadTutorContext(
    supabase,
    { courseId, session, openedSections },
    new Date(),
  );
  if (firstReply && loaded.nextTopicId !== null) {
    // Loaded on use: `workflow/api` fails to import in the component tests
    // (docs/agents/notes/workflow-imports.md).
    const { queueProblemGeneration } =
      await import("@/features/study/server/problem-generation");
    await queueProblemGeneration(supabase, courseId, loaded.nextTopicId);
  }
  return {
    context: loaded.context,
    tools: tutorTools(
      tutorToolActions(supabase, {
        courseId,
        chatId,
        sessionId: session?.id ?? null,
        facts: loaded.exam,
        map: loaded.map,
        topics: loaded.topics,
        readings: loaded.readings,
        reserved: loaded.reserved,
      }),
    ),
  };
}

function tutorToolActions(
  supabase: Supabase,
  {
    courseId,
    chatId,
    sessionId,
    facts,
    map,
    topics,
    readings,
    reserved,
  }: {
    courseId: string;
    chatId: string;
    sessionId: string | null;
    facts: Parameters<typeof loadRecall>[2];
    map: KnowledgeMap;
    topics: Awaited<ReturnType<typeof loadStoredTopics>>;
    readings: Awaited<ReturnType<typeof loadReadingSections>>;
    /** The reserved exam's chunks, which no tool gives the AI. */
    reserved: Set<string>;
  },
): TutorToolActions {
  const kcById = new Map(map.kcs.map((kc) => [kc.id, kc]));
  const session = () => {
    if (sessionId === null) {
      throw new TutorToolError("This Chat has no Study session yet.");
    }
    return sessionId;
  };
  const requireKnown = (kcIds: string[]) => {
    const unknown = kcIds.filter((id) => !kcById.has(id));
    if (unknown.length > 0) {
      throw new TutorToolError(
        `These are no KC ids of this Course: ${unknown.join(", ")}. Use the KC ids of the context or of getTopic.`,
      );
    }
  };
  const sourceOf = (chunk: Parameters<typeof sourceView>[1]) =>
    sourceView(courseId, chunk);
  const retention = desiredRetention(facts.goal);
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
        sessionId: session(),
        kcIds,
        exerciseId,
        problemId: generatedProblemId,
      });
      return { questionId, generatedProblemId };
    },
    async findQuestion() {
      const [question, end] = await Promise.all([
        findNewestQuestion(supabase, session()),
        getSessionEnd(supabase, chatId),
      ]);
      if (!question) return null;
      return {
        ...question,
        // A KC retired since the ask is out of the map.
        kcIds: question.kcIds.filter((id) => kcById.has(id)),
        retiredKcIds: question.kcIds.filter((id) => !kcById.has(id)),
        sessionEnded: end !== null,
      };
    },
    async saveGrade({ questionId, help, results, check }) {
      const saved = await saveAttempts(supabase, {
        questionId,
        sessionId: session(),
        help,
        results,
        check,
      });
      if (!saved) return null;
      const recall = await loadRecall(supabase, courseId, facts, new Date());
      return results.map(({ kcId, result }) => ({
        id: kcId,
        name: kcById.get(kcId)?.name ?? kcId,
        result,
        ...kcBand(recall.get(kcId), retention),
      }));
    },
    closeQuestion: (questionId) => closeQuestion(supabase, questionId),
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
      const [recall, assumes] = await Promise.all([
        loadRecall(supabase, courseId, facts, new Date()),
        loadKcAssumes(supabase, courseId),
      ]);
      const bandOf = (id: string) => kcBand(recall.get(id), retention);
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
        kcs: kcs.map((kc) => {
          const { band, recallToday } = bandOf(kc.id);
          return {
            id: kc.id,
            name: kc.name,
            description: kc.description,
            band,
            recallToday,
            assumes: assumes.get(kc.id) ?? [],
            sources: wanted.has(kc.id)
              ? chunks
                  .filter((chunk) => kc.sources.includes(chunk.id))
                  .slice(0, SOURCES_PER_KC)
                  .map(sourceOf)
              : [],
          };
        }),
        anchors:
          topic &&
          topicAnchors(topic.kcs, map).map((kc) => ({
            ...kc,
            band: bandOf(kc.id).band,
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
