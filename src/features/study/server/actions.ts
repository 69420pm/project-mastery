"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { briefPath } from "@/features/brief";
import {
  answerMapFindingSchema,
  endSessionSchema,
  examResultSchema,
  flagProblemSchema,
  mockExamSchema,
  queueMockExamSchema,
  rateSessionSchema,
  saveMemorySchema,
  saveMockAnswerSchema,
  setTopicChoiceSchema,
  topicKnowledgeMapSchema,
} from "@/features/study/schemas";
import { recordExamResult } from "@/features/study/server/exam-results";
import { answerOpenMapFinding } from "@/features/study/server/map-findings";
import { appendMemory } from "@/features/study/server/memory";
import {
  saveMockAnswer,
  startMock,
  submitMock,
} from "@/features/study/server/mock-sheet";
import { flagReadyProblem } from "@/features/study/server/problems";
import { closeIdleSession, endSession } from "@/features/study/server/sessions";
import type {
  ProblemFlag,
  SessionSummary,
  TopicKnowledgeMap,
} from "@/features/study/types";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { parseActionInput, type ActionResult } from "@/lib/validation/action";

/**
 * Saves the Student's edit of a Course's Memory: replaces the whole text,
 * creating the row on the first save. Empty text clears the Memory. It
 * overwrites any line the AI added since the page loaded.
 */
export async function saveMemory(input: {
  courseId: string;
  text: string;
}): Promise<ActionResult> {
  if (!(await getUser())) {
    return { ok: false, message: "Sign in again to continue." };
  }
  const parsed = parseActionInput(saveMemorySchema, input);
  if (!parsed.ok) return parsed;

  const { courseId, text } = parsed.data;
  const { error } = await (
    await createClient()
  )
    .from("memories")
    .upsert({ course_id: courseId, text }, { onConflict: "course_id" });
  if (error?.code === "42501") {
    return { ok: false, message: "This Course was not found." };
  }
  if (error) throw new Error(`Saving the Memory failed: ${error.message}`);

  revalidatePath(briefPath(courseId));
  return { ok: true, data: undefined };
}

/**
 * Ends the Study session of one of the Student's Chats now, for End session.
 * A session that ended already stays as it is, and one gone idle ends at its
 * newest message.
 */
export async function endStudySession(input: {
  chatId: string;
}): Promise<ActionResult> {
  if (!(await getUser())) {
    return { ok: false, message: "Sign in again to continue." };
  }
  const parsed = parseActionInput(endSessionSchema, input);
  if (!parsed.ok) return parsed;

  const { chatId } = parsed.data;
  const supabase = await createClient();
  const now = new Date();
  if (await closeIdleSession(supabase, chatId, now)) {
    return { ok: true, data: undefined };
  }
  if (!(await endSession(supabase, chatId, now.toISOString()))) {
    return { ok: false, message: "This Chat has no study session to end." };
  }
  return { ok: true, data: undefined };
}

/**
 * The close card's view of a Chat's Study session, computed as if it had
 * ended (`loadSessionSummary`).
 */
export async function getSessionSummary(input: {
  chatId: string;
}): Promise<ActionResult<SessionSummary>> {
  if (!(await getUser())) {
    return { ok: false, message: "Sign in again to continue." };
  }
  const parsed = parseActionInput(endSessionSchema, input);
  if (!parsed.ok) return parsed;
  const { loadSessionSummary } = await loadReads();
  const summary = await loadSessionSummary(
    await createClient(),
    parsed.data.chatId,
  );
  if (!summary) {
    return { ok: false, message: "This Chat has no study session." };
  }
  return { ok: true, data: summary };
}

/**
 * Saves the Student's rating of a Chat's Study session, 1 to 5 with an
 * optional note, replacing an earlier one. It ends a running session now,
 * or one gone idle at its newest message.
 */
export async function rateStudySession(input: {
  chatId: string;
  rating: number;
  note?: string;
}): Promise<ActionResult> {
  if (!(await getUser())) {
    return { ok: false, message: "Sign in again to continue." };
  }
  const parsed = parseActionInput(rateSessionSchema, input);
  if (!parsed.ok) return parsed;

  const { chatId, rating, note } = parsed.data;
  const supabase = await createClient();
  const now = new Date();
  if (!(await closeIdleSession(supabase, chatId, now))) {
    await endSession(supabase, chatId, now.toISOString());
  }
  const { saveRating } = await loadReads();
  if (!(await saveRating(supabase, chatId, rating, note || null))) {
    return { ok: false, message: "This Chat has no study session to rate." };
  }
  return { ok: true, data: undefined };
}

/**
 * A Topic's part of the Knowledge map with the Student's KC states, for the
 * Chat's side slot after a rebuild: the Topic's KCs and anchors
 * (`restrictMapToTopic`).
 */
export async function getTopicKnowledgeMap(input: {
  courseId: string;
  topicId: string;
}): Promise<ActionResult<TopicKnowledgeMap>> {
  if (!(await getUser())) {
    return { ok: false, message: "Sign in again to continue." };
  }
  const parsed = parseActionInput(topicKnowledgeMapSchema, input);
  if (!parsed.ok) return parsed;

  const { loadTopicKnowledgeMap } = await loadReads();
  const topic = await loadTopicKnowledgeMap(
    parsed.data.courseId,
    parsed.data.topicId,
  );
  if (!topic) return { ok: false, message: "This Topic was not found." };
  return { ok: true, data: topic };
}

/**
 * Flags a generated Problem from its question card, once: a flagged
 * Problem leaves the pool `findProblems` draws from.
 */
export async function flagProblem(input: {
  problemId: string;
  flag: ProblemFlag;
}): Promise<ActionResult> {
  if (!(await getUser())) {
    return { ok: false, message: "Sign in again to continue." };
  }
  const parsed = parseActionInput(flagProblemSchema, input);
  if (!parsed.ok) return parsed;

  if (
    !(await flagReadyProblem(
      await createClient(),
      parsed.data.problemId,
      parsed.data.flag,
    ))
  ) {
    return { ok: false, message: "This problem was flagged already." };
  }
  return { ok: true, data: undefined };
}

/**
 * Mock exam on the Today card, and Assemble another: the Course's open Mock
 * exam, or a new one whose assembly starts, for its page.
 */
export async function queueMockExam(input: {
  courseId: string;
}): Promise<ActionResult<{ mockId: string }>> {
  if (!(await getUser())) {
    return { ok: false, message: "Sign in again to continue." };
  }
  const parsed = parseActionInput(queueMockExamSchema, input);
  if (!parsed.ok) return parsed;

  // Loaded on use: `workflow/api` fails to import in the component tests
  // that reach this module (docs/agents/notes/workflow-imports.md).
  const { queueMockAssembly } =
    await import("@/features/study/server/mock-assembly");
  const mockId = await queueMockAssembly(
    await createClient(),
    parsed.data.courseId,
  );
  if (!mockId) return { ok: false, message: "This Course was not found." };
  return { ok: true, data: { mockId } };
}

/** Start on a ready Mock exam's page: its task sheet opens. */
export async function startMockExam(input: {
  mockId: string;
}): Promise<ActionResult> {
  if (!(await getUser())) {
    return { ok: false, message: "Sign in again to continue." };
  }
  const parsed = parseActionInput(mockExamSchema, input);
  if (!parsed.ok) return parsed;
  if (!(await startMock(await createClient(), parsed.data.mockId))) {
    return { ok: false, message: "This mock exam has started already." };
  }
  return { ok: true, data: undefined };
}

/**
 * Saves a mock task's answer and confidence when the Student leaves its
 * box, while the mock runs.
 */
export async function saveMockTaskAnswer(input: {
  questionId: string;
  answer: string;
  confidence: number | null;
}): Promise<ActionResult> {
  if (!(await getUser())) {
    return { ok: false, message: "Sign in again to continue." };
  }
  const parsed = parseActionInput(saveMockAnswerSchema, input);
  if (!parsed.ok) return parsed;
  const { questionId, answer, confidence } = parsed.data;
  const saved = await saveMockAnswer(
    await createClient(),
    questionId,
    answer,
    confidence,
    new Date(),
  );
  if (saved === "closed") {
    return { ok: false, message: "Time is up: this answer was not saved." };
  }
  if (saved === "unknown") {
    return { ok: false, message: "This task was not found." };
  }
  return { ok: true, data: undefined };
}

/**
 * Submit on the task sheet, and its countdown at 0: ends the Mock exam and
 * starts its grading. One that is not in progress any more stays as it is.
 */
export async function submitMockExam(input: {
  mockId: string;
}): Promise<ActionResult> {
  if (!(await getUser())) {
    return { ok: false, message: "Sign in again to continue." };
  }
  const parsed = parseActionInput(mockExamSchema, input);
  if (!parsed.ok) return parsed;
  if (await submitMock(await createClient(), parsed.data.mockId)) {
    // Loaded on use, as `queueMockExam`'s assembly.
    const { startMockGrading } =
      await import("@/features/study/server/mock-grading");
    await startMockGrading(parsed.data.mockId);
  }
  return { ok: true, data: undefined };
}

/**
 * The session summary and Topic Knowledge map reads, imported on first use:
 * they load the knowledge-map feature's server code, which client modules
 * that import these actions (the close card, the Topic graph) must not pull
 * in when they load, as their tests do.
 */
async function loadReads() {
  const [summary, topicKnowledgeMap] = await Promise.all([
    import("@/features/study/server/session-summary"),
    import("@/features/study/server/topic-knowledge-map"),
  ]);
  return { ...summary, ...topicKnowledgeMap };
}

/**
 * Pins or skips a Topic of the Student's Course, or clears the choice with
 * null. A new choice replaces the old one. A skip's reason goes to the
 * Memory as "Skipped <Topic>: <reason>"; `reasonKept` is false when the
 * Memory is full, and the skip is saved anyway.
 */
export async function setTopicChoice(input: {
  courseId: string;
  topicId: string;
  choice: "pinned" | "skipped" | null;
  reason?: string;
}): Promise<ActionResult<{ reasonKept: boolean }>> {
  if (!(await getUser())) {
    return { ok: false, message: "Sign in again to continue." };
  }
  const parsed = parseActionInput(setTopicChoiceSchema, input);
  if (!parsed.ok) return parsed;

  const { courseId, topicId, choice, reason } = parsed.data;
  const supabase = await createClient();
  const { data: topic, error: topicError } = await supabase
    .from("topics")
    .select("name")
    .eq("id", topicId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (topicError) {
    throw new Error(`Reading the Topic failed: ${topicError.message}`);
  }
  if (!topic) return { ok: false, message: "This Topic was not found." };

  const { error } =
    choice === null
      ? await supabase.from("topic_choices").delete().eq("topic_id", topicId)
      : await supabase.from("topic_choices").upsert(
          {
            topic_id: topicId,
            choice,
            created_at: new Date().toISOString(),
          },
          { onConflict: "owner,topic_id" },
        );
  if (error) throw new Error(`Saving the choice failed: ${error.message}`);

  let reasonKept = true;
  if (choice === "skipped" && reason) {
    reasonKept = await appendMemory(
      supabase,
      courseId,
      `Skipped ${topic.name}: ${reason}`,
    );
  }
  revalidatePath("/", "layout");
  return { ok: true, data: { reasonKept } };
}

/**
 * Accept or Dismiss on the Map findings card: answers an open map Finding
 * of the Student's. An accepted one is applied at the next Update map. A
 * Finding that is no longer open stays as it is, and the page refreshes.
 */
export async function answerMapFinding(
  id: string,
  status: "accepted" | "dismissed",
): Promise<ActionResult> {
  if (!(await getUser())) {
    return { ok: false, message: "Sign in again to continue." };
  }
  const parsed = parseActionInput(answerMapFindingSchema, { id, status });
  if (!parsed.ok) return parsed;
  await answerOpenMapFinding(
    await createClient(),
    parsed.data.id,
    parsed.data.status,
  );
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/**
 * Save and Skip on the exam card: stores the Student's grade of a Course's
 * exam, or none when they skip, once per exam date.
 */
export async function saveExamResult(input: {
  courseId: string;
  examDate: string;
  grade: string | null;
}): Promise<ActionResult> {
  if (!(await getUser())) {
    return { ok: false, message: "Sign in again to continue." };
  }
  const parsed = parseActionInput(examResultSchema, input);
  if (!parsed.ok) return parsed;
  if (!(await recordExamResult(await createClient(), parsed.data))) {
    return { ok: false, message: "This Course was not found." };
  }
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
