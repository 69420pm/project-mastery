import "server-only";
import {
  gradeExamCall,
  type ExamGrading,
  type GradeExamInput,
} from "@/features/study/ai/grade-exam-call";
import {
  awardedPoints,
  checkedResult,
  checkMockValue,
  mockScore,
  type MockCheck,
} from "@/features/study/domain/mock-grading";
import { loadItemSource } from "@/features/study/server/mock-results";
import { meteredGenerate } from "@/features/usage/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The steps of `gradeMock` (#186). Each runs on the admin client, since no
 * Student is signed in, and is idempotent: it changes only a submitted
 * mock and items grading has not finished, so a rerun is safe.
 */

/** The ids of the submitted mock's items grading has not finished. */
export async function loadUngradedItems(mockId: string): Promise<string[]> {
  "use step";
  const supabase = createAdminClient();
  if (!(await loadSubmitted(supabase, mockId))) return [];
  const { data, error } = await supabase
    .from("mock_items")
    .select("id, position")
    .eq("mock_id", mockId)
    .is("graded_at", null);
  if (error) failed("Loading the mock exam's items", error);
  return data.toSorted((a, b) => a.position - b.position).map(({ id }) => id);
}

async function loadSubmitted(supabase: Supabase, mockId: string) {
  const { data, error } = await supabase
    .from("mock_exams")
    .select("owner, course_id, session_id")
    .eq("id", mockId)
    .eq("status", "submitted")
    .maybeSingle();
  if (error) failed("Loading the submitted mock exam", error);
  return data;
}

/**
 * Grades one item: a blank answer gets 0 points and every KC `wrong`
 * without a call; an answer one `grade_exam` call, its final value checked
 * against the key. Stores a `mock` attempt per KC with the Question's
 * grading claim, then the item's points, steps and check. Throws when the
 * call fails, so the workflow retries the step.
 */
export async function gradeMockItem(itemId: string): Promise<void> {
  "use step";
  const supabase = createAdminClient();
  const { data: item, error } = await supabase
    .from("mock_items")
    .select(
      "id, mock_id, owner, prompt, points, exercise_id, problem_id, question_id",
    )
    .eq("id", itemId)
    .is("graded_at", null)
    .maybeSingle();
  if (error) failed("Loading the mock exam's item", error);
  if (!item) return;
  const mock = await loadSubmitted(supabase, item.mock_id);
  if (!mock) return;
  const question = await loadQuestion(supabase, item.question_id);
  const answer = question?.answer?.trim() ? question.answer : null;

  let grading: ExamGrading;
  let check: MockCheck = null;
  if (answer === null) {
    grading = {
      steps: [],
      results: (question?.kcIds ?? []).map((kcId) => ({
        kcId,
        result: "wrong",
      })),
      finalValue: null,
    };
  } else {
    const source = await loadItemSource(supabase, item);
    const { call, grading: read } = gradeExamCall({
      prompt: item.prompt,
      points: item.points,
      reference: source.reference,
      answer,
      kcs: await loadKcs(supabase, question?.kcIds ?? []),
    });
    const result = await meteredGenerate(
      supabase,
      {
        studentId: item.owner,
        task: "grade_exam",
        traceName: "grade-mock-item",
        dailyLimit: "ignore",
      },
      call,
    );
    // The provider's daily quota: a later retry may get through.
    if (!result) throw new Error("The grade_exam call got no answer.");
    grading = read(result.output);
    check = checkMockValue(source.keys, grading.finalValue);
  }

  if (question) {
    await saveMockAttempts(supabase, {
      owner: item.owner,
      questionId: question.id,
      sessionId: question.sessionId,
      results: grading.results.map(({ kcId, result }) => ({
        kcId,
        result: checkedResult(result, check),
      })),
      check,
    });
  }
  const { error: itemError } = await supabase
    .from("mock_items")
    .update({
      points_awarded: awardedPoints(grading.steps, item.points, check),
      steps: grading.steps,
      check,
      graded_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .is("graded_at", null);
  if (itemError) failed("Storing the item's grade", itemError);
}

type ItemQuestion = {
  id: string;
  sessionId: string;
  answer: string | null;
  kcIds: string[];
};

async function loadQuestion(
  supabase: Supabase,
  questionId: string | null,
): Promise<ItemQuestion | null> {
  if (questionId === null) return null;
  const { data, error } = await supabase
    .from("questions")
    .select("id, session_id, answer_text")
    .eq("id", questionId)
    .maybeSingle();
  if (error) failed("Loading the item's Question", error);
  if (!data) return null;
  const kcs = await supabase
    .from("question_kcs")
    .select("kc_id")
    .eq("question_id", questionId);
  if (kcs.error) failed("Loading the item's KCs", kcs.error);
  return {
    id: data.id,
    sessionId: data.session_id,
    answer: data.answer_text,
    kcIds: kcs.data.map(({ kc_id }) => kc_id),
  };
}

async function loadKcs(
  supabase: Supabase,
  kcIds: string[],
): Promise<GradeExamInput["kcs"]> {
  if (kcIds.length === 0) return [];
  const { data, error } = await supabase
    .from("kcs")
    .select("id, name, description")
    .in("id", kcIds);
  if (error) failed("Loading the item's KCs", error);
  return data;
}

/**
 * Marks the item's Question graded and stores one `mock` attempt per KC,
 * help `none`; stores nothing when it was graded already.
 */
async function saveMockAttempts(
  supabase: Supabase,
  grade: {
    owner: string;
    questionId: string;
    sessionId: string;
    results: ExamGrading["results"];
    check: MockCheck;
  },
): Promise<void> {
  const { data: claimed, error } = await supabase
    .from("questions")
    .update({ graded_at: new Date().toISOString() })
    .eq("id", grade.questionId)
    .is("graded_at", null)
    .select("id");
  if (error) failed("Grading the item's Question", error);
  if (claimed.length === 0 || grade.results.length === 0) return;
  const { error: attemptsError } = await supabase.from("attempts").insert(
    grade.results.map(({ kcId, result }) => ({
      owner: grade.owner,
      question_id: grade.questionId,
      session_id: grade.sessionId,
      kc_id: kcId,
      kind: "mock",
      result,
      help: "none",
      check: grade.check,
    })),
  );
  if (attemptsError) {
    await supabase
      .from("questions")
      .update({ graded_at: null })
      .eq("id", grade.questionId);
    failed("Saving the item's attempts", attemptsError);
  }
}

/** Marks an item grading failed for: done, without points or attempts. */
export async function failMockItem(itemId: string): Promise<void> {
  "use step";
  const { error } = await createAdminClient()
    .from("mock_items")
    .update({ graded_at: new Date().toISOString() })
    .eq("id", itemId)
    .is("graded_at", null);
  if (error) failed("Marking the item ungradable", error);
}

/**
 * Makes the submitted mock graded with its score and Brier score once
 * grading has finished with every item.
 */
export async function finishMockGrading(mockId: string): Promise<void> {
  "use step";
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("mock_items")
    .select("points, points_awarded, predicted_success, graded_at")
    .eq("mock_id", mockId);
  if (error) failed("Loading the graded items", error);
  if (data.some((item) => item.graded_at === null)) return;
  const { score, brier } = mockScore(
    data.map((item) => ({
      points: item.points,
      awarded: item.points_awarded,
      predictedSuccess: item.predicted_success,
    })),
  );
  const { error: mockError } = await supabase
    .from("mock_exams")
    .update({
      status: "graded",
      score,
      brier,
      graded_at: new Date().toISOString(),
    })
    .eq("id", mockId)
    .eq("status", "submitted");
  if (mockError) failed("Making the mock exam graded", mockError);
}
