import type { LanguageModelUsage } from "ai";
import { MODEL_PRICES } from "./prices";

/** Token counts of one AI call, as recorded and priced (ADR 0006). */
export type TokenUsage = {
  /** All input tokens, cached ones included. */
  inputTokens: number;
  /** The part of `inputTokens` read from the provider's prompt cache. */
  cachedInputTokens: number;
  /** All output tokens, reasoning included. */
  outputTokens: number;
};

/** Token counts from the usage an AI SDK call reports. */
export function tokenUsage(
  usage: Pick<
    LanguageModelUsage,
    "inputTokens" | "inputTokenDetails" | "outputTokens"
  >,
): TokenUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    cachedInputTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  };
}

/** Cost of one AI call in US dollars, from the static price table. */
export function costUsd(modelId: string, usage: TokenUsage): number {
  const price = MODEL_PRICES[modelId];
  if (!price) {
    throw new Error(
      `No price for model "${modelId}". Add it to MODEL_PRICES in src/lib/ai/prices.ts.`,
    );
  }
  const uncachedInput = usage.inputTokens - usage.cachedInputTokens;
  return (
    (uncachedInput * price.input +
      usage.cachedInputTokens * price.cachedInput +
      usage.outputTokens * price.output) /
    1_000_000
  );
}

const CHARACTERS_PER_TOKEN = 4;

/**
 * Estimated token counts of an aborted or failed call, for which providers
 * report no usage: about four characters per token of the text sent and
 * received.
 */
export function estimatedUsage(text: {
  input: string;
  output: string;
}): TokenUsage {
  const tokens = (value: string) =>
    Math.ceil(value.length / CHARACTERS_PER_TOKEN);
  return {
    inputTokens: tokens(text.input),
    cachedInputTokens: 0,
    outputTokens: tokens(text.output),
  };
}
