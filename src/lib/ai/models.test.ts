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
import {
  AI_TASKS,
  aiTask,
  aiTaskCandidate,
  answeringModel,
  defaultModelChoice,
  modelChoices,
  modelIdFor,
} from "./models";
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
    vi.stubEnv("AI_MODEL_CHAT", "google/gemini-3.8-flash");

    expect(modelIdFor("chat")).toBe("google/gemini-3.8-flash");
  });

  test("rejects an override that is not a gateway model id", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL_CHAT", "gpt");

    expect(() => modelIdFor("chat")).toThrow(/AI_MODEL_CHAT/);
  });

  test("treats an empty override as unset", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL_CHAT", "");

    expect(modelIdFor("chat")).toBe(AI_TASKS.chat.model);
  });

  test.each([" google/gemini-3.8-flash", "google/gemini-3.8-flash x"])(
    "rejects an override with junk around the id: %j",
    (id) => {
      vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
      vi.stubEnv("AI_MODEL_CHAT", id);

      expect(() => modelIdFor("chat")).toThrow(/AI_MODEL_CHAT/);
    },
  );

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
  test("is no longer a provider", () => {
    vi.stubEnv("AI_PROVIDER", "google");
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");

    expect(() => modelIdFor("chat")).toThrow(/AI_PROVIDER/);
  });
});

/**
 * Stubs the Google key (undefined for none) and restores the global default
 * provider after the test, since routing installs one for the process.
 */
function stubGoogleKey(key: string | undefined) {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", key);
  const previous = globalThis.AI_SDK_DEFAULT_PROVIDER;
  globalThis.AI_SDK_DEFAULT_PROVIDER = undefined;
  onTestFinished(() => {
    globalThis.AI_SDK_DEFAULT_PROVIDER = previous;
  });
}

describe("Gemini API for local development (ADR 0016)", () => {
  test("sends google ids to the Gemini API and every other id to the gateway", () => {
    stubGoogleKey("test-google-key");
    vi.stubEnv("AI_MODEL_CHAT", "google/gemini-3.5-flash-lite");

    expect(aiTask("chat").model).toBe("google/gemini-3.5-flash-lite");
    const router = globalThis.AI_SDK_DEFAULT_PROVIDER;
    expect(router).toBeDefined();
    const gemini = router!.languageModel("google/gemini-3.5-flash-lite");
    expect(gemini.modelId).toBe("gemini-3.5-flash-lite");
    expect(gemini.provider).toMatch(/google/);
    expect(
      router!.languageModel("xiaomi/mimo-v2.6-flash").provider,
    ).not.toMatch(/google/);
  });

  test("keeps embeddings on the gateway", () => {
    stubGoogleKey("test-google-key");

    expect(aiTask("embed").model).toBe("cohere/embed-v5.0-fast");
    const router = globalThis.AI_SDK_DEFAULT_PROVIDER;
    if (!router || !("embeddingModel" in router)) {
      throw new Error("the Gemini router has no embedding models");
    }
    const embedding = router.embeddingModel("cohere/embed-v5.0-fast");
    expect(embedding.provider).not.toMatch(/google/);
  });

  test("needs the key for a google id", () => {
    stubGoogleKey(undefined);
    vi.stubEnv("AI_MODEL_CHAT", "google/gemini-3.5-flash-lite");

    expect(() => aiTask("chat")).toThrow(/GOOGLE_GENERATIVE_AI_API_KEY/);
  });

  test("mock mode answers google ids without the key", () => {
    stubGoogleKey(undefined);
    vi.stubEnv("AI_PROVIDER", "mock");
    vi.stubEnv("AI_MODEL_CHAT", "google/gemini-3.5-flash-lite");

    expect(aiTask("chat").model).toBe("google/gemini-3.5-flash-lite");
  });

  test("is refused on Vercel, where deployments use the gateway", () => {
    stubGoogleKey("test-google-key");
    vi.stubEnv("VERCEL", "1");

    expect(() => modelIdFor("chat")).toThrow(/Gemini API key/);
  });
});

describe("gateway routing", () => {
  test("tags every call with its task and pins MiMo to DeepInfra", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");

    expect(aiTask("title").providerOptions.gateway).toEqual({
      tags: ["task:title"],
      only: ["deepinfra"],
    });
    expect(aiTask("chat").providerOptions.gateway).toEqual({
      tags: ["task:chat"],
      only: ["deepinfra"],
    });
    expect(aiTask("chat", "fast").providerOptions.gateway).toEqual({
      tags: ["task:chat"],
    });
  });

  test("runs a judge candidate with its own routing, and refuses other models", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL_JUDGE", "alibaba/qwen3.7-flash");

    const mimo = aiTaskCandidate("judge", "xiaomi/mimo-v2.6-flash");
    expect(mimo.model).toBe("xiaomi/mimo-v2.6-flash");
    expect(mimo.providerOptions.gateway).toEqual({
      tags: ["task:judge"],
      only: ["deepinfra"],
    });
    expect(aiTaskCandidate("judge", "alibaba/qwen3.7-flash").model).toBe(
      "alibaba/qwen3.7-flash",
    );
    expect(() => aiTaskCandidate("judge", "openai/gpt-5-nano")).toThrow(
      /no candidate/,
    );
  });

  test("tasks that share a model reach their own mock", async () => {
    useMockModels({
      chat: mockTextModel("Chat reply."),
      title: mockTextModel("A title"),
    });

    const chat = await generateText({ ...aiTask("chat"), prompt: "Hi" });
    const title = await generateText({ ...aiTask("title"), prompt: "Hi" });

    expect(chat.text).toBe("Chat reply.");
    expect(title.text).toBe("A title");
    await expect(
      generateText({ ...aiTask("judge"), prompt: "Hi" }),
    ).rejects.toThrow(/No mock model for task "judge"/);
  });
});

describe("model choices", () => {
  test("offers Fast, Balanced and Thorough for the Chat, Balanced by default", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL_CHAT", undefined);

    expect(modelChoices("chat")).toEqual([
      { key: "fast", label: "Fast", model: "openai/gpt-4.1-nano" },
      { key: "balanced", label: "Balanced", model: "xiaomi/mimo-v2.6-flash" },
      {
        key: "thorough",
        label: "Thorough",
        model: "openai/gpt-5-nano",
      },
    ]);
    expect(aiTask("chat").model).toBe("xiaomi/mimo-v2.6-flash");
    expect(defaultModelChoice("chat")).toBe("balanced");
  });

  test("resolves a choice by its key", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");

    expect(aiTask("chat", "thorough").model).toBe("openai/gpt-5-nano");
    expect(aiTask("chat", "fast").model).toBe("openai/gpt-4.1-nano");
  });

  test("refuses an unknown choice key, including a raw model id", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");

    expect(() => aiTask("chat", "openai/gpt-5-nano")).toThrow(/choice/);
    expect(() => aiTask("judge", "fast")).toThrow(/choice/);
  });

  test("lets the environment override the default choice's model", () => {
    stubGoogleKey("test-google-key");
    vi.stubEnv("AI_MODEL_CHAT", "google/gemini-3.5-flash-lite");

    expect(aiTask("chat").model).toBe("google/gemini-3.5-flash-lite");
    expect(aiTask("chat", "balanced").model).toBe(
      "google/gemini-3.5-flash-lite",
    );
    expect(aiTask("chat", "fast").model).toBe("openai/gpt-4.1-nano");
  });

  test("tasks without choices offer none", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");

    expect(modelChoices("judge")).toEqual([]);
  });
});

describe("title task", () => {
  test("uses the cheapest model", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL_TITLE", undefined);

    expect(aiTask("title").model).toBe("xiaomi/mimo-v2.6-flash");
  });
});

describe("AI_PROVIDER=mock", () => {
  function stubMockProvider() {
    vi.stubEnv("AI_PROVIDER", "mock");
    vi.stubEnv("AI_GATEWAY_API_KEY", undefined);
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

  test("answers every Chat model choice", async () => {
    stubMockProvider();

    for (const choice of modelChoices("chat")) {
      const settings = aiTask("chat", choice.key);
      const { text } = await generateText({ ...settings, prompt: "Hi" });

      expect(settings.model).toBe(choice.model);
      expect(text).toMatch(/^Mock reply to "Hi"\./);
    }
  });
});

describe("aiTask", () => {
  test("configures retries, gateway fallbacks and telemetry", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");

    expect(aiTask("chat")).toEqual({
      model: AI_TASKS.chat.model,
      maxRetries: 3,
      providerOptions: {
        gateway: { tags: ["task:chat"], only: ["deepinfra"] },
      },
      telemetry: { functionId: "chat" },
    });
    expect(aiTask("embed").providerOptions.gateway).toEqual({
      tags: ["task:embed"],
    });
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

describe("answeringModel", () => {
  const settings = {
    model: "google/gemini-3.5-flash-lite",
    providerOptions: { gateway: { models: ["xiaomi/mimo-v2.6-flash"] } },
  };

  test("names the gateway fallback that answered", () => {
    expect(answeringModel(settings, "xiaomi/mimo-v2.6-flash")).toBe(
      "xiaomi/mimo-v2.6-flash",
    );
  });

  test("matches an id reported without its provider prefix", () => {
    expect(answeringModel(settings, "gemini-3.5-flash-lite")).toBe(
      "google/gemini-3.5-flash-lite",
    );
    expect(answeringModel(settings, "mimo-v2.6-flash")).toBe(
      "xiaomi/mimo-v2.6-flash",
    );
  });

  test("falls back to the requested model for an unknown or missing id", () => {
    expect(answeringModel(settings, "some-other-model")).toBe(
      "google/gemini-3.5-flash-lite",
    );
    expect(answeringModel({ model: "google/x" }, undefined)).toBe("google/x");
  });
});
