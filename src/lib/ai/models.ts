import "server-only";
import { google } from "@ai-sdk/google";
import { getAiEnv, type AiEnv } from "./env";

type TaskConfig = {
  /** Gateway model id (`provider/model`), resolved through AI Gateway. */
  model: string;
  /**
   * Models AI Gateway tries in order when the primary fails or is
   * unavailable. Embedding tasks have none: vectors from different models
   * are not comparable.
   */
  fallbacks: readonly string[];
  /** Environment variable that overrides `model` without a code change. */
  override: keyof AiEnv;
};

/**
 * The single per-task model configuration (ADR 0005). Feature
 * code asks for a task through `aiTask`, never for a model id.
 *
 * These are placeholders. Primary models are Google models, so they run both
 * through AI Gateway and directly on the Gemini API free tier, which local
 * development can use instead (ADR 0006). The real model per task is chosen
 * by testing on real course materials (open question in docs/ARCHITECTURE.md).
 */
export const AI_TASKS = {
  /** Socratic tutor chat. */
  tutor: {
    model: "google/gemini-2.5-flash",
    fallbacks: ["xiaomi/mimo-v2.6-flash"],
    override: "AI_MODEL_TUTOR",
  },
  /** Vision: a rendered page image to markdown with LaTeX (ADR 0007). */
  ingest: {
    model: "google/gemini-2.5-flash",
    fallbacks: ["xiaomi/mimo-v2.6-flash"],
    override: "AI_MODEL_INGEST",
  },
  /** Chunk embeddings for pgvector. Changing it means re-embedding. */
  embed: {
    model: "google/gemini-embedding-2",
    fallbacks: [],
    override: "AI_MODEL_EMBED",
  },
  /**
   * LLM-as-judge for evals. Ideally a different family than the tutor, which
   * waits for the model choice: the Gemini API only serves Google models.
   */
  judge: {
    model: "google/gemini-2.5-flash",
    fallbacks: [],
    override: "AI_MODEL_JUDGE",
  },
} as const satisfies Record<string, TaskConfig>;

export type AiTask = keyof typeof AI_TASKS;

/**
 * Retries per call for retryable errors such as `429` from the free tier's
 * rate limits. The AI SDK backs off exponentially and honors `retry-after`.
 */
export const AI_MAX_RETRIES = 3;

/** Resolves the gateway model id for a task, honoring env overrides. */
export function modelIdFor(task: AiTask): string {
  const config = AI_TASKS[task];
  const env = getAiEnv();
  const id = env[config.override] ?? config.model;
  if (env.AI_PROVIDER === "google" && !id.startsWith("google/")) {
    throw new Error(
      `AI_PROVIDER=google only serves Google models, but task "${task}" uses "${id}". Set ${config.override} to a google/ model.`,
    );
  }
  return id;
}

/**
 * With AI_PROVIDER=google, resolves `google/<model>` ids through the Gemini
 * API instead of AI Gateway. Model ids stay plain strings in both modes: the
 * AI SDK resolves them through this global provider, which defaults to AI
 * Gateway (and which tests replace with mocks).
 */
function routeToGeminiApi() {
  // `modelIdFor` has already checked the `google/` prefix.
  const geminiId = (id: string) => id.slice("google/".length);
  globalThis.AI_SDK_DEFAULT_PROVIDER ??= {
    specificationVersion: "v4",
    languageModel: (id) => google.languageModel(geminiId(id)),
    embeddingModel: (id) => google.embeddingModel(geminiId(id)),
    imageModel: (id) => google.imageModel(geminiId(id)),
  };
}

/**
 * Call settings for one AI task: model, retries, gateway fallbacks and
 * telemetry. Spread it into every AI SDK call so each call is configured and
 * traced the same way:
 *
 *   streamText({ ...aiTask("tutor"), instructions, messages })
 *   embed({ ...aiTask("embed"), value })
 */
export function aiTask(task: AiTask) {
  const { fallbacks } = AI_TASKS[task];
  if (getAiEnv().AI_PROVIDER === "google") routeToGeminiApi();
  return {
    model: modelIdFor(task),
    maxRetries: AI_MAX_RETRIES,
    ...(fallbacks.length > 0 && {
      providerOptions: { gateway: { models: [...fallbacks] } },
    }),
    // Spans are emitted only when tracing is registered (src/instrumentation.ts).
    telemetry: { functionId: task },
  };
}
