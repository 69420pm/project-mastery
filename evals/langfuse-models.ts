/**
 * Pushes the model prices in src/lib/ai/prices.ts to Langfuse as custom model
 * definitions, so each traced call gets a cost from the same table that prices
 * `ai_usage` (ADR 0006):
 *
 *   pnpm langfuse:models
 *
 * Langfuse infers a call's cost from the model name it reports. It knows the
 * OpenAI and Google models but not MiMo or Cohere, whose calls showed no cost.
 * A custom definition wins over Langfuse's own, so every model in the table is
 * synced. Safe to run again: it replaces the custom definitions it made.
 */
import { LangfuseClient } from "@langfuse/client";
import { MODEL_PRICES, type ModelPrice } from "@/lib/ai/prices";
import { isLangfuseConfigured } from "@/lib/tracing/env";

/** Names under which a provider reports a model besides its gateway id. */
const REPORTED_AS: Record<string, string[]> = {
  "xiaomi/mimo-v2.6-flash": ["XiaomiMiMo/MiMo-V2.6-Flash"],
};

const PER_MILLION = 1_000_000;

/** Matches the gateway id, the id without its provider (as the Gemini API reports it) and the aliases. */
function matchPattern(modelId: string): string {
  const names = [
    modelId,
    modelId.slice(modelId.indexOf("/") + 1),
    ...(REPORTED_AS[modelId] ?? []),
  ];
  const escaped = names.map((name) =>
    name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return `(?i)^(${escaped.join("|")})$`;
}

/** USD per token, under every key Langfuse's own definitions use for cache reads. */
function tierPrices(price: ModelPrice): Record<string, number> {
  const cachedInput = price.cachedInput / PER_MILLION;
  return {
    input: price.input / PER_MILLION,
    output: price.output / PER_MILLION,
    input_cached_tokens: cachedInput,
    input_cache_read: cachedInput,
    cache_read_input_tokens: cachedInput,
  };
}

async function main() {
  if (!isLangfuseConfigured()) {
    throw new Error("Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY.");
  }
  const { api } = new LangfuseClient();

  const custom = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, meta } = await api.models.list({ page, limit: 100 });
    for (const model of data) {
      if (!model.isLangfuseManaged) custom.set(model.modelName, model.id);
    }
    if (page >= meta.totalPages) break;
  }

  for (const [modelId, price] of Object.entries(MODEL_PRICES)) {
    const existing = custom.get(modelId);
    if (existing) await api.models.delete(existing);
    await api.models.create({
      modelName: modelId,
      matchPattern: matchPattern(modelId),
      unit: "TOKENS",
      pricingTiers: [
        {
          name: "Standard",
          isDefault: true,
          priority: 0,
          conditions: [],
          prices: tierPrices(price),
        },
      ],
    });
    console.info(`${existing ? "updated" : "created"} ${modelId}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
