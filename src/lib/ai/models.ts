import "server-only";
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
 * The single per-task model configuration (ARCHITECTURE decision 5). Feature
 * code asks for a task through `aiTask`, never for a model id.
 *
 * These are placeholders from the AI Gateway free tier, which development runs
 * on (decision 6). The real model per task is chosen by testing on real
 * course materials (open question in docs/ARCHITECTURE.md).
 */
export const AI_TASKS = {
  /** Socratic tutor chat. */
  tutor: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: ["google/gemini-2.5-flash"],
    override: "AI_MODEL_TUTOR",
  },
  /** Vision: a rendered page image to markdown with LaTeX (decision 7). */
  ingest: {
    model: "google/gemini-2.5-flash",
    fallbacks: ["xiaomi/mimo-v2.6-flash"],
    override: "AI_MODEL_INGEST",
  },
  /** Chunk embeddings for pgvector. Changing it means re-embedding. */
  embed: {
    model: "openai/text-embedding-3-small",
    fallbacks: [],
    override: "AI_MODEL_EMBED",
  },
  /** LLM-as-judge for evals; a different family than the tutor. */
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
  return getAiEnv()[config.override] ?? config.model;
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
