import "server-only";
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
 * These are placeholders: MiMo V2.6 Flash does the text work for its price,
 * with a Google model behind it as gateway fallback (ADR 0006). The real
 * model per task is chosen by testing on real course materials (open question
 * in docs/ARCHITECTURE.md).
 */
export const AI_TASKS = {
  /** The AI's replies in a Chat. The Student picks one of the choices. */
  chat: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: ["google/gemini-3.5-flash-lite"],
    override: "AI_MODEL_CHAT",
    choices: {
      fast: { label: "Fast", model: "google/gemini-3.1-flash-lite" },
      balanced: { label: "Balanced", model: "xiaomi/mimo-v2.6-flash" },
      thorough: { label: "Thorough", model: "google/gemini-3.8-flash" },
    },
  },
  /**
   * A short title for a Chat, on a small model of its own: tests route mock
   * models by model id, so a task that must be told apart from the Chat needs
   * an id the Chat does not use.
   */
  title: {
    model: "google/gemini-3.1-flash-lite",
    fallbacks: [],
    override: "AI_MODEL_TITLE",
  },
  /** Vision: a rendered page image to markdown with LaTeX (ADR 0007). */
  ingest: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: ["google/gemini-3.5-flash-lite"],
    override: "AI_MODEL_INGEST",
  },
  /** Builds a Course's Knowledge map from its chunks, one call per step. */
  map: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: ["google/gemini-3.5-flash-lite"],
    override: "AI_MODEL_MAP",
  },
  /**
   * One exercise subtask of a Knowledge map build: its KCs, task type and a
   * solution to check the given one against. Calls add medium thinking.
   */
  exercise: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: ["google/gemini-3.5-flash-lite"],
    override: "AI_MODEL_EXERCISE",
  },
  /**
   * Chunk embeddings for pgvector. Changing the model or its dimensions means
   * re-embedding and a new `chunks.embedding` column size.
   */
  embed: {
    model: "cohere/embed-v5.0-fast",
    fallbacks: [],
    override: "AI_MODEL_EMBED",
  },
  /**
   * LLM-as-judge for evals: a different family than the models it judges, and
   * a cheap one, since an eval run judges every answer.
   */
  judge: {
    model: "google/gemini-3.5-flash-lite",
    fallbacks: [],
    override: "AI_MODEL_JUDGE",
  },
} as const satisfies Record<string, TaskConfig>;

export type AiTask = keyof typeof AI_TASKS;

/** The keys of a task's model choices, such as "fast" for the Chat. */
export type ModelChoiceKey<Task extends AiTask> =
  (typeof AI_TASKS)[Task] extends { choices: infer Choices }
    ? keyof Choices & string
    : never;

/**
 * Retries per call for retryable errors such as `429` from rate limits. The
 * AI SDK backs off exponentially and honors `retry-after`.
 */
export const AI_MAX_RETRIES = 3;

const taskConfig = (task: AiTask): TaskConfig => AI_TASKS[task];

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
 * The key of a task's default model choice: the one whose model is the
 * task's configured model.
 */
export function defaultModelChoice<Task extends AiTask>(
  task: Task,
): ModelChoiceKey<Task> {
  const config = taskConfig(task);
  const entry = Object.entries(config.choices ?? {}).find(
    ([, choice]) => choice.model === config.model,
  );
  if (!entry) throw new Error(`Task "${task}" has no default model choice.`);
  return entry[0] as ModelChoiceKey<Task>;
}

/**
 * The model choices a Student is offered for a task, in display order. Tasks
 * without choices offer none.
 */
export function modelChoices(task: AiTask): ModelChoice[] {
  return allChoices(task);
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
    return chosen.model;
  }
  return overrideFor(task) ?? taskConfig(task).model;
}

/**
 * The model that answered a call made with `aiTask` settings: the requested
 * model or one of its gateway fallbacks, as named by the model id the
 * provider reports (`response.modelId`), so the call is stored and priced as
 * that model. Reported ids may lack the `provider/` prefix. An id that names none of them, or none at all, as for an
 * aborted call, means the requested model.
 */
export function answeringModel(
  settings: {
    model: string;
    providerOptions?: { gateway?: { models: readonly string[] } };
  },
  reportedModelId: string | undefined,
): string {
  const candidates = [
    settings.model,
    ...(settings.providerOptions?.gateway?.models ?? []),
  ];
  const withoutProvider = (id: string) => id.slice(id.indexOf("/") + 1);
  return (
    candidates.find((id) => id === reportedModelId) ??
    candidates.find((id) => withoutProvider(id) === reportedModelId) ??
    settings.model
  );
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
  if (getAiEnv().AI_PROVIDER === "mock") routeToMockModels();
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
