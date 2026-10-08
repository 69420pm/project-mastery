// @vitest-environment node
import { embed, generateText } from "ai";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  onTestFinished,
  test,
  vi,
} from "vitest";
import { AI_TASKS, aiTask, modelChoices, modelIdFor } from "./models";
import { mockEmbeddingModel, mockTextModel, useMockModels } from "./testing";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
});

// Each test starts from AI Gateway mode, whatever the developer's shell sets.
beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", undefined);
});

describe("modelIdFor", () => {
  test("uses the configured model for a task", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL_CHAT", undefined);

    expect(modelIdFor("chat")).toBe(AI_TASKS.chat.model);
  });

  test("lets an environment variable override a task's model", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL_CHAT", "google/gemini-2.5-flash-lite");

    expect(modelIdFor("chat")).toBe("google/gemini-2.5-flash-lite");
  });

  test("rejects an override that is not a gateway model id", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL_CHAT", "gpt");

    expect(() => modelIdFor("chat")).toThrow(/AI_MODEL_CHAT/);
  });

  test("rejects an override without a price, since every call is priced", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL_CHAT", "acme/unpriced");

    expect(() => modelIdFor("chat")).toThrow(/acme\/unpriced.*price/);
  });

  test("requires an AI Gateway key outside Vercel", () => {
    // Empty, as copied from .env.example.
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", undefined);
    vi.stubEnv("VERCEL", undefined);

    expect(() => modelIdFor("chat")).toThrow(/AI_GATEWAY_API_KEY/);
  });

  test("accepts OIDC on Vercel without a key", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", undefined);
    vi.stubEnv("VERCEL", "1");

    expect(() => modelIdFor("chat")).not.toThrow();
  });
});

describe("AI_PROVIDER=google", () => {
  function stubGeminiApi() {
    vi.stubEnv("AI_PROVIDER", "google");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
    vi.stubEnv("AI_GATEWAY_API_KEY", undefined);
    vi.stubEnv("VERCEL", undefined);
  }

  // Starts from the AI SDK's default global provider (AI Gateway).
  function clearGlobalProvider() {
    const previous = globalThis.AI_SDK_DEFAULT_PROVIDER;
    globalThis.AI_SDK_DEFAULT_PROVIDER = undefined;
    onTestFinished(() => {
      globalThis.AI_SDK_DEFAULT_PROVIDER = previous;
    });
  }

  test("needs no AI Gateway key", () => {
    stubGeminiApi();

    expect(modelIdFor("chat")).toBe(AI_TASKS.chat.model);
  });

  test("requires a Gemini API key", () => {
    stubGeminiApi();
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");

    expect(() => modelIdFor("chat")).toThrow(/GOOGLE_GENERATIVE_AI_API_KEY/);
  });

  test("is refused on Vercel", () => {
    stubGeminiApi();
    vi.stubEnv("VERCEL", "1");

    expect(() => modelIdFor("chat")).toThrow(/AI_PROVIDER/);
  });

  test("rejects models that are not from Google", () => {
    stubGeminiApi();
    vi.stubEnv("AI_MODEL_CHAT", "xiaomi/mimo-v2.6-flash");

    expect(() => modelIdFor("chat")).toThrow(/AI_MODEL_CHAT/);
  });

  test("resolves model ids through the Gemini API", () => {
    stubGeminiApi();
    clearGlobalProvider();

    const { model } = aiTask("chat");

    expect(model).toBe("google/gemini-2.5-flash");
    expect(
      globalThis.AI_SDK_DEFAULT_PROVIDER?.languageModel(model),
    ).toMatchObject({
      provider: expect.stringMatching(/^google/),
      modelId: "gemini-2.5-flash",
    });
  });
});

describe("model choices", () => {
  test("offers Fast, Balanced and Thorough for the Chat, Balanced by default", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL_CHAT", undefined);

    expect(modelChoices("chat")).toEqual([
      { key: "fast", label: "Fast", model: "google/gemini-2.5-flash-lite" },
      { key: "balanced", label: "Balanced", model: "google/gemini-2.5-flash" },
      { key: "thorough", label: "Thorough", model: "google/gemini-2.5-pro" },
    ]);
    expect(aiTask("chat").model).toBe("google/gemini-2.5-flash");
  });

  test("resolves a choice by its key", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");

    expect(aiTask("chat", "thorough").model).toBe("google/gemini-2.5-pro");
    expect(aiTask("chat", "fast").model).toBe("google/gemini-2.5-flash-lite");
  });

  test("refuses an unknown choice key, including a raw model id", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");

    expect(() => aiTask("chat", "google/gemini-2.5-pro")).toThrow(/choice/);
    expect(() => aiTask("judge", "fast")).toThrow(/choice/);
  });

  test("lets the environment override the default choice's model", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL_CHAT", "xiaomi/mimo-v2.6-flash");

    expect(aiTask("chat").model).toBe("xiaomi/mimo-v2.6-flash");
    expect(aiTask("chat", "balanced").model).toBe("xiaomi/mimo-v2.6-flash");
    expect(aiTask("chat", "fast").model).toBe("google/gemini-2.5-flash-lite");
  });

  test("offers only Google choices with AI_PROVIDER=google", () => {
    vi.stubEnv("AI_PROVIDER", "google");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("AI_MODEL_CHAT", undefined);
    const previous = globalThis.AI_SDK_DEFAULT_PROVIDER;
    onTestFinished(() => {
      globalThis.AI_SDK_DEFAULT_PROVIDER = previous;
    });
    // Simulates a non-Google choice, which only AI Gateway serves.
    const fast = AI_TASKS.chat.choices.fast;
    const model = fast.model;
    Object.assign(fast, { model: "xiaomi/mimo-v2.6-flash" });
    onTestFinished(() => {
      Object.assign(fast, { model });
    });

    expect(modelChoices("chat").map((choice) => choice.key)).toEqual([
      "balanced",
      "thorough",
    ]);
    expect(() => aiTask("chat", "fast")).toThrow(/AI_PROVIDER=google/);
  });

  test("tasks without choices offer none", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");

    expect(modelChoices("judge")).toEqual([]);
  });
});

describe("title task", () => {
  test("uses the cheapest model in both provider modes", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL_TITLE", undefined);

    expect(aiTask("title").model).toBe("google/gemini-2.5-flash-lite");

    vi.stubEnv("AI_PROVIDER", "google");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
    vi.stubEnv("VERCEL", undefined);
    const previous = globalThis.AI_SDK_DEFAULT_PROVIDER;
    onTestFinished(() => {
      globalThis.AI_SDK_DEFAULT_PROVIDER = previous;
    });

    expect(aiTask("title").model).toBe("google/gemini-2.5-flash-lite");
  });
});

describe("aiTask", () => {
  test("configures retries, gateway fallbacks and telemetry", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");

    expect(aiTask("chat")).toEqual({
      model: AI_TASKS.chat.model,
      maxRetries: 3,
      providerOptions: { gateway: { models: [...AI_TASKS.chat.fallbacks] } },
      telemetry: { functionId: "chat" },
    });
    expect(aiTask("embed")).not.toHaveProperty("providerOptions");
  });

  // The pattern for testing feature code that calls a model.
  test("runs AI SDK calls against mock models", async () => {
    useMockModels({
      judge: mockTextModel("PASS"),
      embed: mockEmbeddingModel(4),
    });

    const { text } = await generateText({
      ...aiTask("judge"),
      prompt: "Grade this.",
    });
    const { embedding } = await embed({ ...aiTask("embed"), value: "chunk" });

    expect(text).toBe("PASS");
    expect(embedding).toHaveLength(4);
  });

  test("routes every model choice of a task to its mock", async () => {
    useMockModels({ chat: mockTextModel("Try it yourself first.") });

    const { text } = await generateText({
      ...aiTask("chat", "thorough"),
      prompt: "Solve this.",
    });

    expect(text).toBe("Try it yourself first.");
  });
});
