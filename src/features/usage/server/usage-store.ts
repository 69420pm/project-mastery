import "server-only";
import { costUsd, type TokenUsage } from "@/lib/ai/cost";
import type { AiTask } from "@/lib/ai/models";
import type { Supabase } from "@/lib/supabase/types";

/**
 * Records and sums AI usage as the signed-in Student, so Row Level Security
 * applies: a Student adds and reads only their own records and can never
 * change or delete them.
 */

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
 * Records one AI call for the signed-in Student, priced in US dollars from
 * the price table (ADR 0006). Throws when the model has no price or the
 * insert fails.
 */
export async function recordAiUsage(
  supabase: Supabase,
  { task, modelId, usage, estimated = false, chatId }: AiUsageRecord,
): Promise<void> {
  const { error } = await supabase.from("ai_usage").insert({
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

/** The signed-in Student's AI spend in US dollars since `since`. */
export async function spentSinceUsd(
  supabase: Supabase,
  since: Date,
): Promise<number> {
  const { data, error } = await supabase
    .from("ai_usage")
    .select("cost_usd")
    .gte("created_at", since.toISOString());
  if (error) throw new Error(`Loading AI usage failed: ${error.message}`);
  return data.reduce((sum, row) => sum + Number(row.cost_usd), 0);
}
