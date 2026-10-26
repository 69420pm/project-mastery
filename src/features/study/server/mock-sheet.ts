import "server-only";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/** What saving a mock task's answer did. */
export type MockAnswerSaved = "saved" | "closed" | "unknown";

/**
 * Starts the Student's ready mock (`start_mock_exam`): its session and one
 * Question per item. False when it is not theirs or not ready.
 */
export async function startMock(
  supabase: Supabase,
  mockId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("start_mock_exam", {
    p_mock_id: mockId,
  });
  if (error) failed("Starting the mock exam", error);
  return data;
}

/**
 * Submits the Student's mock in progress and ends its session
 * (`submit_mock_exam`). False when it is not theirs or not in progress.
 */
export async function submitMock(
  supabase: Supabase,
  mockId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("submit_mock_exam", {
    p_mock_id: mockId,
  });
  if (error) failed("Submitting the mock exam", error);
  return data;
}

/**
 * Stores a mock task's answer, blank as none, and confidence. `closed` when
 * its mock is not running any more (the database refuses it), `unknown`
 * when it is no mock task of the Student's.
 */
export async function saveMockAnswer(
  supabase: Supabase,
  questionId: string,
  answer: string,
  confidence: number | null,
  now: Date,
): Promise<MockAnswerSaved> {
  const text = answer.trim() === "" ? null : answer;
  const { data, error } = await supabase
    .from("questions")
    .update({
      answer_text: text,
      confidence,
      answered_at: text === null ? null : now.toISOString(),
    })
    .eq("id", questionId)
    .eq("kind", "mock_item")
    .select("id");
  // Raised by the questions_check_mock_answer trigger.
  if (error?.code === "55000") return "closed";
  if (error) failed("Saving the answer", error);
  return data.length > 0 ? "saved" : "unknown";
}
