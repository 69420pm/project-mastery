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
 * These are placeholders: MiMo V2.6 Flash does the text work for its price
 * (ADR 0006), and the other choices are models the Gateway's free credit
 * serves (verified live on 2026-10-14: no Google model, no MiMo Pro). The
 * real model per task is chosen by testing on real course materials (open
 * question in docs/ARCHITECTURE.md).
 */
export const AI_TASKS = {
  /** The AI's replies in a Chat. The Student picks one of the choices. */
  chat: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: [],
    override: "AI_MODEL_CHAT",
    // The other two take PDFs, which Chats attach raw and MiMo does not.
    choices: {
      fast: { label: "Fast", model: "openai/gpt-4.1-nano" },
      balanced: { label: "Balanced", model: "xiaomi/mimo-v2.6-flash" },
      thorough: { label: "Thorough", model: "openai/gpt-5-nano" },
    },
  },
  /** The AI's replies in a Course's Brief, where it asks about the exam. */
  brief: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: [],
    override: "AI_MODEL_BRIEF",
  },
  /** A short title for a Chat, on the cheapest model. */
  title: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: [],
    override: "AI_MODEL_TITLE",
  },
  /** Vision: a rendered page image to markdown with LaTeX (ADR 0007). */
  ingest: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: [],
    override: "AI_MODEL_INGEST",
  },
  /** Builds a Course's Knowledge map from its chunks, one call per step. */
  map: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: [],
    override: "AI_MODEL_MAP",
  },
  /**
   * One exercise subtask of a Knowledge map build: its KCs, task type and a
   * solution to check the given one against. Calls add medium thinking.
   */
  exercise: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: [],
    override: "AI_MODEL_EXERCISE",
  },
  /**
   * One call per priority run that adjusts the KCs' Priority multipliers
   * from the Brief's notes and the answered Findings, with structured output.
   */
  priority: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: [],
    override: "AI_MODEL_PRIORITY",
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
   * LLM-as-judge for evals: cheap, since an eval run judges every answer, and
   * smarter than the small Google models. It is the Chat's family, which can
   * favour the Chat's own answers.
   */
  judge: {
    model: "xiaomi/mimo-v2.6-flash",
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
 * The providers AI Gateway may use for a model. Verified live on 2026-10-14:
 * of the six providers of `xiaomi/mimo-v2.6-flash`, only `deepinfra` honors
 * the JSON schema of a structured output (the others get `json_object` mode
 * and answer in their own shape, so `Output.object` fails), and it is the
 * only one with zero data retention and no prompt training. `order` is not
 * enough: with an image in the request the Gateway ignored it. `only` also
 * excludes the `models` fallbacks, so MiMo tasks have none.
 */
const ONLY_PROVIDERS: Record<string, readonly string[]> = {
  "xiaomi/mimo-v2.6-flash": ["deepinfra"],
};

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
    providerOptions?: { gateway?: { models?: readonly string[] } };
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
  const only = ONLY_PROVIDERS[model];
  if (getAiEnv().AI_PROVIDER === "mock") routeToMockModels();
  return {
    model,
    maxRetries: AI_MAX_RETRIES,
    providerOptions: {
      gateway: {
        // Groups the Gateway's spend reports by task.
        tags: [`task:${task}`],
        ...(only && { only: [...only] }),
        ...(fallbacks.length > 0 && { models: [...fallbacks] }),
      },
    },
    // Spans are emitted only when tracing is registered (src/instrumentation.ts).
    telemetry: { functionId: task },
  };
}
