import { costUsd, type TokenUsage } from "@/lib/ai/cost";
import type { ReplyUsage } from "@/features/chat/types";

/** A reply's usage as the Chat shows it, priced with the model that answered. */
export function replyUsage(
  modelId: string,
  usage: TokenUsage,
  estimated: boolean,
): ReplyUsage {
  return { ...usage, costUsd: costUsd(modelId, usage), estimated };
}

/** A token count in short form: "640", "12.3k", "1.2M". */
export function tokenCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${+(count / 1000).toFixed(1)}k`;
  return `${+(count / 1_000_000).toFixed(1)}M`;
}

/** "in 12.3k (8.1k cached) · out 640". */
export function tokensText(usage: ReplyUsage): string {
  const cached =
    usage.cachedInputTokens > 0
      ? ` (${tokenCount(usage.cachedInputTokens)} cached)`
      : "";
  return `in ${tokenCount(usage.inputTokens)}${cached} · out ${tokenCount(usage.outputTokens)}`;
}

/** "$0.0012", or "<$0.0001" for a tiny cost. */
export function costText(costUsd: number): string {
  if (costUsd === 0) return "$0";
  if (costUsd < 0.0001) return "<$0.0001";
  return `$${costUsd.toFixed(costUsd < 0.01 ? 4 : 2)}`;
}
