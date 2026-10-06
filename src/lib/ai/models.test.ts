// @vitest-environment node
import { embed, generateText } from "ai";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AI_TASKS, aiTask, modelIdFor } from "./models";
import { mockEmbeddingModel, mockTextModel, useMockModels } from "./testing";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
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
