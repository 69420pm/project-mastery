import "server-only";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { gateway } from "ai";
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
};

/**
 * The single per-task model configuration (ADR 0005). Feature
 * code asks for a task through `aiTask`, never for a model id.
 *
 * These are placeholders: MiMo V2.6 Flash does the text work for its price
 * (ADR 0006), and the Gateway's free credit serves it (verified live on
 * 2026-10-14: no Google model, no MiMo Pro). The real model per task is chosen by testing on real course materials (open
 * question in docs/ARCHITECTURE.md). Local development can point a text task
 * at `google/gemini-3.5-flash-lite` through its override (ADR 0016).
 */
export const AI_TASKS = {
  /** The AI's replies in a Chat. */
  chat: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: [],
    override: "AI_MODEL_CHAT",
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
  /** Builds a Course's Knowledge map from its chunks. */
  map: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: [],
    override: "AI_MODEL_MAP",
  },
  /** The Exercises of a Knowledge map build and the KCs they test. */
  exercise: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: [],
    override: "AI_MODEL_EXERCISE",
  },
  /** Names the Topics of a Knowledge map build, with structured output. */
  topic: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: [],
    override: "AI_MODEL_TOPIC",
  },
  /**
   * Two calls per new Reading section of a Knowledge map build: its reading
   * mode, then its annotations or study text, with structured output.
   */
  reading: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: [],
    override: "AI_MODEL_READING",
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
   * One call per generated Problem, a variant of an Exercise or a new
   * Problem, with structured output and medium thinking; a draft whose
   * program fails goes back once.
   */
  generate: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: [],
    override: "AI_MODEL_GENERATE",
  },
  /**
   * One call per answered item of a submitted Mock exam: points per step
   * with reasons, a result per KC and the final value, with structured
   * output. Metered, but not refused at the Daily limit.
   */
  grade_exam: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: [],
    override: "AI_MODEL_GRADE_EXAM",
  },
  /**
   * One call per ended Study session that writes its Session note, its
   * Topic's Topic note and Memory lines, and condenses a long Memory, with
   * structured output. Metered, but not refused at the Daily limit.
   */
  close: {
    model: "xiaomi/mimo-v2.6-flash",
    fallbacks: [],
    override: "AI_MODEL_CLOSE",
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
} as const satisfies Record<string, TaskConfig>;

export type AiTask = keyof typeof AI_TASKS;

/**
 * Retries per call for retryable errors such as `429` from rate limits. The
 * AI SDK backs off exponentially and honors `retry-after`.
 */
const AI_MAX_RETRIES = 3;

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
  "minimax/minimax-m3.1-flash": ["fireworks"],
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

/** Resolves the gateway model id for a task, honoring env overrides. */
export function modelIdFor(task: AiTask): string {
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

/** Model ids the Gemini API serves directly, when a Google key is set. */
const GOOGLE_PREFIX = "google/";

/**
 * Local development (ADR 0016): sends `google/` model ids straight to the
 * Gemini API with the Google key, and every other id through AI Gateway,
 * which serves no Google model on its free credit. MiMo and the embeddings
 * stay on the gateway.
 */
function routeToGeminiApi(apiKey: string) {
  globalThis.AI_SDK_DEFAULT_PROVIDER ??= geminiRouter(apiKey);
}

function geminiRouter(apiKey: string) {
  const google = createGoogleGenerativeAI({ apiKey });
  const geminiId = (id: string) => id.slice(GOOGLE_PREFIX.length);
  return {
    specificationVersion: "v4" as const,
    languageModel: (id: string) =>
      id.startsWith(GOOGLE_PREFIX)
        ? google.languageModel(geminiId(id))
        : gateway.languageModel(id),
    embeddingModel: (id: string) =>
      id.startsWith(GOOGLE_PREFIX)
        ? google.embeddingModel(geminiId(id))
        : gateway.embeddingModel(id),
    imageModel: (id: string) => gateway.imageModel(id),
  };
}

/** Routes model ids for this environment. Mock mode answers every id. */
function routeModels(env: AiEnv) {
  if (env.AI_PROVIDER === "mock") routeToMockModels();
  else if (env.GOOGLE_GENERATIVE_AI_API_KEY) {
    routeToGeminiApi(env.GOOGLE_GENERATIVE_AI_API_KEY);
  }
}

/**
 * Call settings for one AI task: model, retries, gateway fallbacks and
 * telemetry. Spread it into every AI SDK call so each call is configured and
 * traced the same way:
 *
 *   streamText({ ...aiTask("chat"), instructions, messages })
 *   embed({ ...aiTask("embed"), value })
 */
export function aiTask(task: AiTask) {
  return taskSettings(task, modelIdFor(task));
}

function taskSettings(task: AiTask, model: string) {
  const { fallbacks } = AI_TASKS[task];
  const env = getAiEnv();
  if (
    env.AI_PROVIDER !== "mock" &&
    model.startsWith(GOOGLE_PREFIX) &&
    !env.GOOGLE_GENERATIVE_AI_API_KEY
  ) {
    throw new Error(
      `"${model}" needs GOOGLE_GENERATIVE_AI_API_KEY (local development, ADR 0016)`,
    );
  }
  routeModels(env);
  const only = ONLY_PROVIDERS[model];
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
