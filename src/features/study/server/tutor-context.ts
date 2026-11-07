import "server-only";
import { getBriefNotes } from "@/features/brief/server";
import {
  loadKcAssumes,
  loadReadingSections,
  topicAnchors,
} from "@/features/knowledge-map/server";
import { tutorContext } from "@/features/study/domain/tutor-context";
import { loadAskedProblems } from "@/features/study/server/attempts";
import { loadMemory } from "@/features/study/server/memory";
import { taskGrade } from "@/features/study/server/mock-results";
import { loadMaterialNotes } from "@/features/study/server/notes";
import { loadReadyProblems } from "@/features/study/server/problems";
import {
  loadSessionQuestions,
  type TutorSession,
} from "@/features/study/server/questions";
import {
  loadReservedChunks,
  withoutReserved,
  withoutReservedSections,
} from "@/features/study/server/reserved-exam";
import { readingLabel } from "@/features/study/server/source-view";
import { loadStudy } from "@/features/study/server/study-state";
import type { ContextMockTask, TutorContext } from "@/features/study/types";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * Reads what a Chat's reply tutors with at `now` and derives its tutor
 * context (`tutorContext`). Returns the reads the tools share too: the map
 * and Reading sections without the reserved exam, the reserved chunks, the
 * Topics and the exam facts. `openedSections` are the Reading sections the
 * session's `showReading` calls opened.
 */
export async function loadTutorContext(
  supabase: Supabase,
  {
    courseId,
    session,
    openedSections,
  }: {
    courseId: string;
    session: TutorSession | null;
    openedSections: string[];
  },
  now: Date,
) {
  const [
    study,
    storedReadings,
    reserved,
    memory,
    briefNotes,
    materialNotes,
    assumes,
    asked,
    ready,
    questions,
    mock,
  ] = await Promise.all([
    loadStudy(supabase, courseId, now),
    loadReadingSections(supabase, courseId),
    loadReservedChunks(supabase, courseId),
    loadMemory(supabase, courseId),
    getBriefNotes(supabase, courseId),
    loadMaterialNotes(supabase, courseId),
    loadKcAssumes(supabase, courseId),
    loadAskedProblems(supabase, courseId),
    loadReadyProblems(supabase, courseId),
    session ? loadSessionQuestions(supabase, session.id) : [],
    session?.mockId ? loadMockTasks(supabase, session.mockId) : null,
  ]);
  // The reserved exam stays unseen: the tutor never gets its chunks.
  const map = withoutReserved(study.map, reserved);
  const readings = withoutReservedSections(storedReadings, reserved);
  const topicNotes = await loadTopicNotes(
    supabase,
    study.topics.map(({ id }) => id),
  );
  const sectionViews = new Map(
    [...readings].map(([topicId, sections]) => [
      topicId,
      sections.map((section) => ({
        id: section.id,
        label: readingLabel(section),
      })),
    ]),
  );
  const allSections = [...sectionViews.values()].flat();

  const context: TutorContext = tutorContext({
    now,
    exam: study.exam,
    kcs: map.kcs.map((kc) => ({
      id: kc.id,
      name: kc.name,
      assumes: assumes.get(kc.id) ?? [],
    })),
    anchors: (kcIds) => topicAnchors(kcIds, map).map(({ id }) => id),
    topics: study.topics,
    scope: study.scope,
    ranked: study.ranked,
    recall: study.recall,
    attempts: study.attempts,
    session: {
      id: session?.id ?? "",
      startedAt: session?.startedAt ?? now.toISOString(),
      questions,
      readings: [...new Set(openedSections)].flatMap(
        (id) => allSections.find((section) => section.id === id) ?? [],
      ),
    },
    readings: sectionViews,
    unseenProblems: [
      ...map.exercises.filter(({ id }) => !asked.has(id)),
      ...ready.filter(({ id }) => !asked.has(id)),
    ],
    notes: { topics: topicNotes, memory, briefNotes, materialNotes },
    mock,
  });
  const next = study.ranked.find((item) => item.kind === "topic");
  return {
    context,
    map,
    readings,
    reserved,
    topics: study.topics,
    exam: study.exam,
    /** The ranking's next Topic, whose Problem stock a first reply tops up. */
    nextTopicId: next?.topicId ?? null,
  };
}

/** The Topic notes of `topicIds`, by Topic id. */
async function loadTopicNotes(
  supabase: Supabase,
  topicIds: string[],
): Promise<Map<string, string>> {
  if (topicIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("topic_notes")
    .select("topic_id, text")
    .in("topic_id", topicIds);
  if (error) failed("Loading the Topic notes", error);
  return new Map(data.map((row) => [row.topic_id, row.text]));
}

/** A graded Mock exam's tasks, most points lost first. */
async function loadMockTasks(
  supabase: Supabase,
  mockId: string,
): Promise<ContextMockTask[]> {
  const { data, error } = await supabase
    .from("mock_items")
    .select(
      "prompt, points, points_awarded, steps, graded_at, check, exercise_id, problem_id, questions(answer_text)",
    )
    .eq("mock_id", mockId)
    .order("position");
  if (error) failed("Loading the mock's tasks", error);
  const lost = (task: ContextMockTask) => task.points - (task.awarded ?? 0);
  return data
    .map((item): ContextMockTask => {
      const grade = taskGrade(item);
      return {
        prompt: item.prompt,
        answer: item.questions?.answer_text ?? null,
        points: item.points,
        awarded: item.points_awarded,
        reasons:
          grade?.status === "graded"
            ? grade.steps.map(
                ({ points, reason }) => `${reason} (${points} points)`,
              )
            : [],
        problemId: item.exercise_id ?? item.problem_id,
      };
    })
    .toSorted((a, b) => lost(b) - lost(a));
}
