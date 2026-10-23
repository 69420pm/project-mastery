import "server-only";
import { z } from "zod";
import { finalAnswerSchema } from "@/features/knowledge-map";
import type {
  FinalValueCheck,
  QuestionToGrade,
} from "@/features/study/ai/tools";
import type {
  AttemptHelp,
  AttemptResult,
} from "@/features/study/domain/ladder";
import type { QuestionKind } from "@/features/study/types";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * Questions the AI asks in a Chat's Study session, the Student's answers on
 * their task cards, and the attempts their grading stores (ADR 0018).
 */

const isUuid = (value: string) => z.uuid().safeParse(value).success;

/** The id of the Chat's Study session, or null without one. */
export async function loadSessionId(
  supabase: Supabase,
  chatId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("study_sessions")
    .select("id")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (error) failed("Loading the Study session", error);
  return data?.id ?? null;
}

/** Stores a question with its KCs in a session; returns its id. */
export async function insertQuestion(
  supabase: Supabase,
  question: {
    sessionId: string;
    kind: QuestionKind;
    prompt: string;
    kcIds: string[];
    exerciseId: string | null;
  },
): Promise<string> {
  const { data, error } = await supabase
    .from("questions")
    .insert({
      session_id: question.sessionId,
      kind: question.kind,
      prompt: question.prompt,
      exercise_id: question.exerciseId,
    })
    .select("id")
    .single();
  if (error) failed("Saving the question", error);
  const { error: kcsError } = await supabase.from("question_kcs").insert(
    [...new Set(question.kcIds)].map((kcId) => ({
      question_id: data.id,
      kc_id: kcId,
    })),
  );
  if (kcsError) failed("Saving the question's KCs", kcsError);
  return data.id;
}

/** A question of the session, as `grade` checks it; null for any other id. */
export async function findSessionQuestion(
  supabase: Supabase,
  sessionId: string,
  questionId: string,
): Promise<QuestionToGrade | null> {
  if (!isUuid(questionId)) return null;
  const { data, error } = await supabase
    .from("questions")
    .select(
      "kind, answered_at, graded_at, question_kcs(kc_id), exercises(final_answers)",
    )
    .eq("id", questionId)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) failed("Loading the question", error);
  if (!data) return null;
  // A key that no longer parses is no key: the check then doesn't apply.
  const finalAnswers = z
    .array(finalAnswerSchema)
    .safeParse(data.exercises?.final_answers);
  return {
    kind: data.kind as QuestionKind,
    kcIds: data.question_kcs.map(({ kc_id }) => kc_id),
    answered: data.answered_at !== null,
    graded: data.graded_at !== null,
    finalAnswers: finalAnswers.success ? finalAnswers.data : null,
  };
}

/**
 * Marks an answered, ungraded question graded and stores one attempt per
 * KC. False when it was graded in the meantime, storing nothing.
 */
export async function saveAttempts(
  supabase: Supabase,
  grade: {
    questionId: string;
    sessionId: string;
    kind: "pre" | "learn";
    help: AttemptHelp;
    results: Array<{ kcId: string; result: AttemptResult }>;
    /** The numeric check, stored on every attempt; null when it didn't apply. */
    check: FinalValueCheck;
  },
): Promise<boolean> {
  // Claimed first, so a concurrent grade of the same question stores nothing.
  const { data: claimed, error } = await supabase
    .from("questions")
    .update({ graded_at: new Date().toISOString() })
    .eq("id", grade.questionId)
    .is("graded_at", null)
    .not("answered_at", "is", null)
    .select("id");
  if (error) failed("Grading the question", error);
  if (claimed.length === 0) return false;

  const { error: attemptsError } = await supabase.from("attempts").insert(
    grade.results.map(({ kcId, result }) => ({
      question_id: grade.questionId,
      session_id: grade.sessionId,
      kc_id: kcId,
      kind: grade.kind,
      result,
      help: grade.help,
      check: grade.check,
    })),
  );
  if (attemptsError) {
    await supabase
      .from("questions")
      .update({ graded_at: null })
      .eq("id", grade.questionId);
    failed("Saving the attempts", attemptsError);
  }
  return true;
}

/**
 * Whether the Student can answer the question in this Chat: it was asked in
 * the Chat's session and is not graded yet.
 */
export async function isAnswerable(
  supabase: Supabase,
  chatId: string,
  questionId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("questions")
    .select("id, study_sessions!inner(chat_id)")
    .eq("id", questionId)
    .eq("study_sessions.chat_id", chatId)
    .is("graded_at", null)
    .maybeSingle();
  if (error) failed("Loading the question", error);
  return data !== null;
}

/**
 * Stores the Student's answer to a question, sent as the Chat message
 * `messageId`. A later answer replaces an earlier one until it is graded.
 */
export async function recordAnswer(
  supabase: Supabase,
  answer: { questionId: string; messageId: string; text: string },
): Promise<void> {
  const { error } = await supabase
    .from("questions")
    .update({
      answer_text: answer.text,
      answer_message_id: answer.messageId,
      answered_at: new Date().toISOString(),
    })
    .eq("id", answer.questionId)
    .is("graded_at", null);
  if (error) failed("Saving the answer", error);
}

/**
 * The questions answered in a Chat by the id of the message that sent the
 * answer: the latest answer of each.
 */
export async function loadAnswerLinks(
  supabase: Supabase,
  chatId: string,
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("questions")
    .select("id, answer_message_id, study_sessions!inner(chat_id)")
    .eq("study_sessions.chat_id", chatId)
    .not("answer_message_id", "is", null);
  if (error) failed("Loading the answered questions", error);
  return new Map(data.map((row) => [row.answer_message_id!, row.id]));
}
