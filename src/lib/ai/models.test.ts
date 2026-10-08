// @vitest-environment node
import { embed, generateText, streamText } from "ai";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  onTestFinished,
  test,
  vi,
} from "vitest";
import { AI_TASKS, aiTask, modelIdFor } from "./models";
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
    vi.stubEnv("AI_MODEL_TUTOR", undefined);

    expect(modelIdFor("tutor")).toBe(AI_TASKS.tutor.model);
  });

  test("lets an environment variable override a task's model", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL_TUTOR", "google/gemini-2.5-flash-lite");

    expect(modelIdFor("tutor")).toBe("google/gemini-2.5-flash-lite");
  });

  test("rejects an override that is not a gateway model id", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL_TUTOR", "gpt");

    expect(() => modelIdFor("tutor")).toThrow(/AI_MODEL_TUTOR/);
  });

  test("requires an AI Gateway key outside Vercel", () => {
    // Empty, as copied from .env.example.
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", undefined);
    vi.stubEnv("VERCEL", undefined);

    expect(() => modelIdFor("tutor")).toThrow(/AI_GATEWAY_API_KEY/);
  });

  test("accepts OIDC on Vercel without a key", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", undefined);
    vi.stubEnv("VERCEL", "1");

    expect(() => modelIdFor("tutor")).not.toThrow();
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

    expect(modelIdFor("tutor")).toBe(AI_TASKS.tutor.model);
  });

  test("requires a Gemini API key", () => {
    stubGeminiApi();
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");

    expect(() => modelIdFor("tutor")).toThrow(/GOOGLE_GENERATIVE_AI_API_KEY/);
  });

  test("is refused on Vercel", () => {
    stubGeminiApi();
    vi.stubEnv("VERCEL", "1");

    expect(() => modelIdFor("tutor")).toThrow(/AI_PROVIDER/);
  });

  test("rejects models that are not from Google", () => {
    stubGeminiApi();
    vi.stubEnv("AI_MODEL_TUTOR", "xiaomi/mimo-v2.6-flash");

    expect(() => modelIdFor("tutor")).toThrow(/AI_MODEL_TUTOR/);
  });

  test("resolves model ids through the Gemini API", () => {
    stubGeminiApi();
    clearGlobalProvider();

    const { model } = aiTask("tutor");

    expect(model).toBe("google/gemini-2.5-flash");
    expect(
      globalThis.AI_SDK_DEFAULT_PROVIDER?.languageModel(model),
    ).toMatchObject({
      provider: expect.stringMatching(/^google/),
      modelId: "gemini-2.5-flash",
    });
  });
});

describe("AI_PROVIDER=mock", () => {
  function stubMockProvider() {
    vi.stubEnv("AI_PROVIDER", "mock");
    vi.stubEnv("AI_GATEWAY_API_KEY", undefined);
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined);
    vi.stubEnv("VERCEL", undefined);
    const previous = globalThis.AI_SDK_DEFAULT_PROVIDER;
    globalThis.AI_SDK_DEFAULT_PROVIDER = undefined;
    onTestFinished(() => {
      globalThis.AI_SDK_DEFAULT_PROVIDER = previous;
    });
  }

  test("is refused on Vercel", () => {
    stubMockProvider();
    vi.stubEnv("VERCEL", "1");

    expect(() => modelIdFor("judge")).toThrow(/AI_PROVIDER/);
  });

  test("streams a deterministic reply without any key", async () => {
    stubMockProvider();

    const result = streamText({ ...aiTask("judge"), prompt: "What is 2+2?" });
    const deltas: string[] = [];
    for await (const delta of result.textStream) deltas.push(delta);

    expect(deltas.length).toBeGreaterThan(10);
    expect(deltas.join("")).toBe(
      'Mock reply to "What is 2+2?". This is a deterministic answer from the mock AI. It streams word by word, slowly enough for an end-to-end test to stop it before it ends, and it never calls a real model.',
    );
  });

  test("answers generate calls and embeddings", async () => {
    stubMockProvider();

    const { text } = await generateText({
      ...aiTask("judge"),
      messages: [
        { role: "user", content: "First question" },
        { role: "assistant", content: "First answer" },
        { role: "user", content: "Second question" },
      ],
    });
    const { embedding } = await embed({ ...aiTask("embed"), value: "chunk" });

    expect(text).toMatch(/^Mock reply to "Second question"\./);
    expect(embedding.length).toBeGreaterThan(0);
  });
});

describe("aiTask", () => {
  test("configures retries, gateway fallbacks and telemetry", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");

    expect(aiTask("tutor")).toEqual({
      model: AI_TASKS.tutor.model,
      maxRetries: 3,
      providerOptions: { gateway: { models: [...AI_TASKS.tutor.fallbacks] } },
      telemetry: { functionId: "tutor" },
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
});
