import "server-only";
import { z } from "zod";
import { answerKeySchema } from "@/features/knowledge-map/server";
import type {
  FinalValueCheck,
  QuestionToGrade,
} from "@/features/study/ai/tools";
import type {
  AttemptHelp,
  AttemptResult,
} from "@/features/study/domain/replay";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * Questions the AI asks in a Chat's Study session, the Student's answers in
 * the Chat, and the attempts their grading stores (ADR 0018).
 */

const isUuid = (value: string) => z.uuid().safeParse(value).success;

/** The most characters `questions.answer_text` holds. */
const MAX_ANSWER_TEXT = 20_000;

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
    prompt: string;
    kcIds: string[];
    /** The Exercise it poses, or null. */
    exerciseId: string | null;
    /** The generated Problem it poses, or null; never with an Exercise. */
    problemId: string | null;
  },
): Promise<string> {
  const { data, error } = await supabase
    .from("questions")
    .insert({
      session_id: question.sessionId,
      prompt: question.prompt,
      exercise_id: question.exerciseId,
      problem_id: question.problemId,
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

/**
 * A question of the session, as `grade` checks it, but for whether the
 * session has ended; null for any other id.
 */
export async function findSessionQuestion(
  supabase: Supabase,
  sessionId: string,
  questionId: string,
): Promise<Omit<QuestionToGrade, "sessionEnded"> | null> {
  if (!isUuid(questionId)) return null;
  const { data, error } = await supabase
    .from("questions")
    .select(
      "answered_at, graded_at, question_kcs(kc_id), exercises(final_answers), problems(final_answers)",
    )
    .eq("id", questionId)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) failed("Loading the question", error);
  if (!data) return null;
  // The key of the Exercise or generated Problem it poses. A key that no
  // longer parses is no key: the check then doesn't apply.
  const finalAnswers = z
    .array(answerKeySchema)
    .safeParse(
      data.exercises?.final_answers ?? data.problems?.final_answers ?? null,
    );
  return {
    kcIds: data.question_kcs.map(({ kc_id }) => kc_id),
    answered: data.answered_at !== null,
    graded: data.graded_at !== null,
    finalAnswers: finalAnswers.success ? finalAnswers.data : null,
  };
}

/**
 * Marks an answered, ungraded question graded and stores one `learn`
 * attempt per KC. False when it was graded in the meantime, storing
 * nothing.
 */
export async function saveAttempts(
  supabase: Supabase,
  grade: {
    questionId: string;
    sessionId: string;
    help: AttemptHelp;
    results: Array<{ kcId: string; result: AttemptResult }>;
    /** The worst answer check, stored on every attempt; null without keys. */
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
 * Adds the Student's Chat message `messageId` to the answer of the open
 * Question: the newest Question of the Chat's session, while it is
 * ungraded. Every message until its grade is part of the answer, joined in
 * order, and the first is its `answer_message_id`. Nothing is stored when
 * the newest Question is graded or there is none.
 */
export async function recordAnswer(
  supabase: Supabase,
  chatId: string,
  answer: { messageId: string; text: string },
): Promise<void> {
  if (answer.text.trim() === "") return;
  const { data: newest, error } = await supabase
    .from("questions")
    .select("id, answer_text, graded_at, study_sessions!inner(chat_id)")
    .eq("study_sessions.chat_id", chatId)
    .order("asked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) failed("Loading the open question", error);
  if (!newest || newest.graded_at !== null) return;
  const { error: saveError } = await supabase
    .from("questions")
    .update(
      newest.answer_text === null
        ? {
            answer_text: answer.text,
            answer_message_id: answer.messageId,
            answered_at: new Date().toISOString(),
          }
        : {
            answer_text: `${newest.answer_text}\n\n${answer.text}`.slice(
              0,
              MAX_ANSWER_TEXT,
            ),
          },
    )
    .eq("id", newest.id)
    .is("graded_at", null);
  if (saveError) failed("Saving the answer", saveError);
}
