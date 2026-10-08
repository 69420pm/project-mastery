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
 * Standard paid-tier list prices from AI Gateway, which match the providers'
 * own. Gemini 2.5 Pro costs more above 200k prompt tokens; this table uses the
 * lower tier.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "google/gemini-2.5-flash-lite": {
    input: 0.1,
    output: 0.4,
    cachedInput: 0.01,
  },
  "google/gemini-2.5-flash": { input: 0.3, output: 2.5, cachedInput: 0.03 },
  "google/gemini-2.5-pro": { input: 1.25, output: 10, cachedInput: 0.125 },
  "google/gemini-embedding-2": { input: 0.2, output: 0, cachedInput: 0 },
  "xiaomi/mimo-v2.6-flash": { input: 0.04, output: 1.28, cachedInput: 0.04 },
};
