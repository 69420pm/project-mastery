import "server-only";
import { costUsd, type TokenUsage } from "@/lib/ai/cost";
import type { AiTask } from "@/lib/ai/models";
import type { Supabase } from "@/lib/supabase/types";

/**
 * Records and sums AI usage. With the Student's session client, Row Level
 * Security applies: a Student adds and reads only their own records and can
 * never change or delete them. Workflows have no session and pass the admin
 * client with an explicit `studentId`, which then scopes every query.
 */

/** Whose usage to record or sum when the client has no Student session. */
export type StudentScope = {
  /**
   * The Student the usage belongs to. Required with the admin client, which
   * bypasses Row Level Security; omit it with the Student's session client.
   */
  studentId?: string;
};

/** One AI call made for the Student, as recorded. */
export type AiUsageRecord = {
  task: AiTask;
  /** The model that answered, as priced in MODEL_PRICES. */
  modelId: string;
  usage: TokenUsage;
  /** True when `usage` is an estimate, as for an aborted call. */
  estimated?: boolean;
  /** The Chat the call was made for, if any. */
  chatId?: string;
};

/**
 * Records one AI call for the signed-in Student, or for `studentId` when
 * given, priced in US dollars from the price table (ADR 0006). Throws when
 * the model has no price or the insert fails.
 */
export async function recordAiUsage(
  supabase: Supabase,
  { task, modelId, usage, estimated = false, chatId }: AiUsageRecord,
  { studentId }: StudentScope = {},
): Promise<void> {
  const { error } = await supabase.from("ai_usage").insert({
    // Without it, the column defaults to the session's Student (auth.uid()).
    ...(studentId === undefined ? {} : { owner: studentId }),
    task,
    model_id: modelId,
    input_tokens: usage.inputTokens,
    cached_input_tokens: usage.cachedInputTokens,
    output_tokens: usage.outputTokens,
    cost_usd: costUsd(modelId, usage),
    estimated,
    chat_id: chatId ?? null,
  });
  if (error) throw new Error(`Recording AI usage failed: ${error.message}`);
}

/**
 * The signed-in Student's AI spend in US dollars since `since`, or that of
 * `studentId` when given.
 */
export async function spentSinceUsd(
  supabase: Supabase,
  since: Date,
  { studentId }: StudentScope = {},
): Promise<number> {
  let query = supabase
    .from("ai_usage")
    .select("cost_usd")
    .gte("created_at", since.toISOString());
  if (studentId !== undefined) query = query.eq("owner", studentId);
  const { data, error } = await query;
  if (error) throw new Error(`Loading AI usage failed: ${error.message}`);
  return data.reduce((sum, row) => sum + Number(row.cost_usd), 0);
}
