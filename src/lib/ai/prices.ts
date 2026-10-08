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
 * Standard (global) paid-tier list prices, checked on 2026-10-08 against the
 * AI Gateway model list (https://ai-gateway.vercel.sh/v1/models) and Google's
 * Gemini API pricing page (https://ai.google.dev/gemini-api/docs/pricing).
 * The two agree except where noted. AI Gateway's EU and US regional prices
 * are up to 10% higher; this table uses the global price.
 *
 * - Gemini 3.6 to 3.8 Flash rise to $1.50 input, $7.50 output and $0.15
 *   cached input on 2027-01-01 (Google's pricing page).
 * - Gemini 3.1 Flash-Lite cached input is $0.025 at Google and $0.03 through
 *   AI Gateway; this table uses the higher one.
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
  "google/gemini-embedding-2": { input: 0.2, output: 0, cachedInput: 0 },
  "xiaomi/mimo-v2.6-flash": { input: 0.04, output: 1.28, cachedInput: 0.04 },
};
