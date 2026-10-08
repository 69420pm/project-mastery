import "server-only";
import { google } from "@ai-sdk/google";
import { getAiEnv, type AiEnv } from "./env";
import { routeToMockModels } from "./mock-provider";
import { MODEL_PRICES } from "./prices";

export type TaskConfig = {
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
  /**
   * Models a Student can choose from for this task, addressed by key, in
   * display order (ADR 0005). The choice whose model equals `model` is the
   * default, and `override` replaces its model.
   */
  choices?: Record<string, ModelChoiceConfig>;
};

type ModelChoiceConfig = {
  /** Shown to the Student. */
  label: string;
  /** Gateway model id (`provider/model`). */
  model: string;
};

/** A model choice as offered to the Student. */
export type ModelChoice = ModelChoiceConfig & { key: string };

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
  /** The AI's replies in a Chat. The Student picks one of the choices. */
  chat: {
    model: "google/gemini-3.5-flash-lite",
    fallbacks: ["xiaomi/mimo-v2.6-flash"],
    override: "AI_MODEL_CHAT",
    // Every choice is a model the Gemini API free tier serves, so all of them
    // work locally. Thorough is not a Pro model: the free tier serves none.
    choices: {
      fast: { label: "Fast", model: "google/gemini-3.1-flash-lite" },
      balanced: { label: "Balanced", model: "google/gemini-3.5-flash-lite" },
      thorough: { label: "Thorough", model: "google/gemini-3.8-flash" },
    },
  },
  /** A short title for a Chat, on the cheapest model. */
  title: {
    model: "google/gemini-3.1-flash-lite",
    fallbacks: [],
    override: "AI_MODEL_TITLE",
  },
  /** Vision: a rendered page image to markdown with LaTeX (ADR 0007). */
  ingest: {
    model: "google/gemini-3.8-flash",
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
   * LLM-as-judge for evals. Ideally a different family than the Chat's models, which
   * waits for the model choice: the Gemini API only serves Google models. Until
   * then it is at least a different model, with its own free-tier quota.
   */
  judge: {
    model: "google/gemini-3.7-flash",
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

const taskConfig = (task: AiTask): TaskConfig => AI_TASKS[task];

function servedByProvider(id: string): boolean {
  return getAiEnv().AI_PROVIDER !== "google" || id.startsWith("google/");
}

/**
 * The env override of a task's default model. Configured models are checked
 * for prices by a unit test, overrides here, since every call is priced.
 */
function overrideFor(task: AiTask): string | undefined {
  const config = taskConfig(task);
  const override = getAiEnv()[config.override];
  if (override !== undefined && !(override in MODEL_PRICES)) {
    throw new Error(
      `${config.override}="${override}" has no price. Add it to MODEL_PRICES in src/lib/ai/prices.ts.`,
    );
  }
  return override;
}

/** All choices of a task, the default one resolved with the env override. */
function allChoices(task: AiTask): ModelChoice[] {
  const config = taskConfig(task);
  const override = overrideFor(task);
  return Object.entries(config.choices ?? {}).map(([key, choice]) => ({
    key,
    label: choice.label,
    model:
      choice.model === config.model ? (override ?? choice.model) : choice.model,
  }));
}

/**
 * The model choices a Student is offered for a task, in display order. With
 * AI_PROVIDER=google only Google models are offered. Tasks without choices
 * offer none.
 */
export function modelChoices(task: AiTask): ModelChoice[] {
  return allChoices(task).filter((choice) => servedByProvider(choice.model));
}

/**
 * Resolves the gateway model id for a task, honoring env overrides. With a
 * choice key, resolves that choice instead of the task's default model.
 */
export function modelIdFor(task: AiTask, choice?: string): string {
  if (choice !== undefined) {
    const chosen = allChoices(task).find(({ key }) => key === choice);
    if (!chosen) {
      throw new Error(`Task "${task}" has no model choice "${choice}".`);
    }
    if (!servedByProvider(chosen.model)) {
      throw new Error(
        `AI_PROVIDER=google only serves Google models, but choice "${choice}" of task "${task}" uses "${chosen.model}".`,
      );
    }
    return chosen.model;
  }
  const config = taskConfig(task);
  const id = overrideFor(task) ?? config.model;
  if (!servedByProvider(id)) {
    throw new Error(
      `AI_PROVIDER=google only serves Google models, but task "${task}" uses "${id}". Set ${config.override} to a google/ model.`,
    );
  }
  return id;
}

/**
 * The model that answered a call made with `aiTask` settings: the requested
 * model or one of its gateway fallbacks, as named by the model id the
 * provider reports (`response.modelId`), so the call is stored and priced as
 * that model. Reported ids may lack the `provider/` prefix, as the Gemini API
 * reports them. An id that names none of them, or none at all, as for an
 * aborted call, means the requested model.
 */
export function answeringModel(
  settings: {
    model: string;
    providerOptions?: { gateway: { models: readonly string[] } };
  },
  reportedModelId: string | undefined,
): string {
  const candidates = [
    settings.model,
    ...(settings.providerOptions?.gateway.models ?? []),
  ];
  const withoutProvider = (id: string) => id.slice(id.indexOf("/") + 1);
  return (
    candidates.find((id) => id === reportedModelId) ??
    candidates.find((id) => withoutProvider(id) === reportedModelId) ??
    settings.model
  );
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
 * traced the same way. For a task with model choices, pass the Student's
 * choice key (never a raw model id); without one, the default is used:
 *
 *   streamText({ ...aiTask("chat", choice), instructions, messages })
 *   embed({ ...aiTask("embed"), value })
 */
export function aiTask(task: AiTask, choice?: string) {
  const { fallbacks } = AI_TASKS[task];
  const model = modelIdFor(task, choice);
  const { AI_PROVIDER } = getAiEnv();
  if (AI_PROVIDER === "google") routeToGeminiApi();
  if (AI_PROVIDER === "mock") routeToMockModels();
  return {
    model,
    maxRetries: AI_MAX_RETRIES,
    ...(fallbacks.length > 0 && {
      providerOptions: { gateway: { models: [...fallbacks] } },
    }),
    // Spans are emitted only when tracing is registered (src/instrumentation.ts).
    telemetry: { functionId: task },
  };
}
