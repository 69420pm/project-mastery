import "server-only";
import type { LanguageModelUsage } from "ai";
import { estimatedUsage, tokenUsage, type SentFile } from "@/lib/ai/cost";
import type { AiTask } from "@/lib/ai/models";
import type { Supabase, SessionSupabase } from "@/lib/supabase/types";
import { recordAiUsage } from "./usage-store";

/** What one reply's model call used, as its `ai_usage` row records it. */
export type StoredReplyUsage = {
  /** All input tokens, cached ones included. */
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Whether the tokens were estimated, as for a stopped reply. */
  estimated: boolean;
};

/**
 * The recorded usage of the replies among `replyIds`, by reply id. A reply
 * without a record is missing, as is one Row Level Security hides.
 */
export async function loadReplyUsage(
  supabase: Supabase,
  replyIds: string[],
): Promise<Map<string, StoredReplyUsage>> {
  const usage = new Map<string, StoredReplyUsage>();
  if (replyIds.length === 0) return usage;
  const { data, error } = await supabase
    .from("ai_usage")
    .select(
      "reply_id, input_tokens, cached_input_tokens, output_tokens, cost_usd, estimated",
    )
    .in("reply_id", replyIds);
  if (error) {
    throw new Error(`Loading the replies' usage failed: ${error.message}`);
  }
  for (const row of data) {
    if (row.reply_id === null) continue;
    usage.set(row.reply_id, {
      inputTokens: row.input_tokens,
      cachedInputTokens: row.cached_input_tokens,
      outputTokens: row.output_tokens,
      costUsd: Number(row.cost_usd),
      estimated: row.estimated,
    });
  }
  return usage;
}

/**
 * Records the usage of one streamed reply for the signed-in Student, and
 * never throws: a failed record is logged. A stopped or failed call reports
 * no usage, so its cost is then estimated from the text and files sent and
 * the text received. Otherwise stopping or closing the tab would dodge the
 * Daily limit.
 *
 * With a `chatId` whose Chat, or Course, was deleted during the reply, the
 * spend is recorded without the Chat, so it still counts towards the limit.
 */
export async function recordReplyUsage(
  supabase: SessionSupabase,
  {
    task,
    modelId,
    reported,
    input,
    output,
    files,
    chatId,
    replyId,
  }: {
    task: AiTask;
    modelId: string;
    /** What the provider reported, undefined for a stopped or failed call. */
    reported: LanguageModelUsage | undefined;
    /** The text sent: the instructions and the history. */
    input: string;
    /** The reply's text. */
    output: string;
    /** The files sent with the history. */
    files?: SentFile[];
    chatId?: string;
    replyId?: string;
  },
): Promise<void> {
  const usage = reported
    ? { usage: tokenUsage(reported) }
    : {
        usage: estimatedUsage({ input, output, files }),
        estimated: true,
      };
  const record = { task, modelId, ...usage, replyId };
  try {
    await recordAiUsage(supabase, { ...record, chatId });
    return;
  } catch (error) {
    if (chatId === undefined) {
      console.error(`Recording the ${task} reply's usage failed:`, error);
      return;
    }
  }
  try {
    await recordAiUsage(supabase, record);
  } catch (error) {
    console.error(`Recording the ${task} reply's usage failed:`, error);
  }
}
