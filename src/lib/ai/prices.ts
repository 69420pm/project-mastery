/** USD per million tokens. */
export type ModelPrice = {
  input: number;
  output: number;
  /** Input tokens read from the provider's prompt cache. */
  cachedInput: number;
};

/**
 * Prices of every model any task can call: defaults, gateway fallbacks and
 * model choices (ADR 0006). Every AI call is priced from this table in every
 * provider mode, so a model without a price cannot be called; a unit test
 * checks that the task configuration in models.ts is covered.
 *
 * AI Gateway list prices, checked on 2026-10-14 against the AI Gateway model
 * list (https://ai-gateway.vercel.sh/v1/models); the Gemini prices were also
 * checked on 2026-10-08 against Google's Gemini API pricing page
 * (https://ai.google.dev/gemini-api/docs/pricing), where the two agree except
 * where noted. AI Gateway's EU and US regional prices are up to 10% higher;
 * this table uses the global price.
 *
 * - Gemini 3.6 to 3.8 Flash rise to $1.50 input, $7.50 output and $0.15
 *   cached input on 2027-01-01 (Google's pricing page).
 * - Gemini 3.1 Flash-Lite cached input is $0.025 at Google and $0.03 through
 *   AI Gateway; this table uses the higher one.
 * - DeepSeek V4.1 Flash 1017 is priced at its off-peak rate, checked on
 *   2026-10-17 against the AI Gateway model list and DeepSeek's pricing page
 *   (https://api-docs.deepseek.com/quick_start/pricing). Both charge twice
 *   that from 01:00 to 04:00 and 06:00 to 10:00 UTC on weekdays, excluding
 *   Chinese public holidays; this table has no time of day, so calls in those
 *   hours are recorded at half their cost.
 * - Qwen 3.7 Flash is priced at its tier under 32k input tokens, verified live
 *   on 2026-10-23; longer prompts cost more, and judge prompts stay under
 *   it. No cache price was checked, so cached input is priced as fresh input.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "google/gemini-3.1-flash-lite": {
    input: 0.25,
    output: 1.5,
    cachedInput: 0.03,
  },
  "google/gemini-3.5-flash-lite": {
    input: 0.3,
    output: 2.5,
    cachedInput: 0.03,
  },
  "google/gemini-3.7-flash": { input: 0.75, output: 3.75, cachedInput: 0.075 },
  "google/gemini-3.8-flash": { input: 0.75, output: 3.75, cachedInput: 0.075 },
  "openai/gpt-4.1-nano": { input: 0.1, output: 0.4, cachedInput: 0.025 },
  "openai/gpt-5-nano": { input: 0.05, output: 0.4, cachedInput: 0.005 },
  "cohere/embed-v5.0-fast": { input: 0.08, output: 0, cachedInput: 0 },
  "xiaomi/mimo-v2.6-flash": { input: 0.14, output: 0.28, cachedInput: 0.0028 },
  "alibaba/qwen3.7-flash": { input: 0.03, output: 0.13, cachedInput: 0.03 },
  "minimax/minimax-m3.1-flash": {
    input: 0.15,
    output: 0.6,
    cachedInput: 0.015,
  },
  "deepseek/deepseek-v4.1-flash-1017": {
    input: 0.15,
    output: 0.6,
    cachedInput: 0.003,
  },
};
