// @vitest-environment node
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test, vi } from "vitest";
import {
  mockEmbeddingModel,
  mockTextModel,
  useMockModels,
} from "@/lib/ai/testing";
import { aiTask } from "@/lib/ai/models";
import { markAdminClient } from "@/lib/supabase/admin-brand";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";
import type { AdminSupabase, Supabase } from "@/lib/supabase/types";

vi.mock("server-only", () => ({}));

const { meteredEmbed, meteredGenerate } = await import("./metered-call");

const STUDENT = "11111111-1111-1111-1111-111111111111";
const scope = { studentId: STUDENT, traceName: "test-call" };

function adminWith(usage: FakeRow[] = []) {
  const db = fakeSupabase({
    tables: { ai_usage: usage },
    defaults: { ai_usage: () => ({ created_at: new Date().toISOString() }) },
  });
  return {
    db,
    admin: markAdminClient(db as unknown as Supabase) as AdminSupabase,
  };
}

function reachedLimit() {
  vi.stubEnv("AI_DAILY_LIMIT_USD", "1");
  return adminWith([
    { owner: STUDENT, cost_usd: 5, created_at: new Date().toISOString() },
  ]);
}

const quotaError = new APICallError({
  message: "Quota exceeded",
  url: "https://example.com",
  requestBodyValues: {},
  statusCode: 429,
  responseBody: '{"error":{"message":"Requests per day exceeded"}}',
  isRetryable: false,
});

function failingModel(error: Error) {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw error;
    },
  });
}

const generate = (admin: AdminSupabase) =>
  meteredGenerate(
    admin,
    { ...scope, task: "map" },
    {
      ...aiTask("map"),
      prompt: "Hi",
    },
  );

describe("meteredGenerate", () => {
  test("records usage with the answering model and returns the output", async () => {
    useMockModels({ map: mockTextModel("Hello") });
    const { db, admin } = adminWith();

    const result = await generate(admin);

    expect(result?.output).toBe("Hello");
    expect(db.tables.ai_usage).toEqual([
      expect.objectContaining({
        owner: STUDENT,
        task: "map",
        model_id: aiTask("map").model,
        input_tokens: expect.any(Number),
      }),
    ]);
  });

  test("a reached Daily limit makes no call and gives null", async () => {
    const model = mockTextModel("Hello");
    useMockModels({ map: model });
    const { db, admin } = reachedLimit();

    expect(await generate(admin)).toBeNull();
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(db.tables.ai_usage).toHaveLength(1);
  });

  test("a daily-quota error gives null and records nothing", async () => {
    useMockModels({ map: failingModel(quotaError) });
    const { db, admin } = adminWith();

    expect(await generate(admin)).toBeNull();
    expect(db.tables.ai_usage).toEqual([]);
  });

  test("another error goes to callFailed", async () => {
    useMockModels({ map: failingModel(new Error("boom")) });
    const { admin } = adminWith();
    const call = meteredGenerate(
      admin,
      {
        ...scope,
        task: "map",
        callFailed: () => {
          throw new Error("the step's own");
        },
      },
      { ...aiTask("map"), maxRetries: 0, prompt: "Hi" },
    );

    await expect(call).rejects.toThrow("the step's own");
  });
});

describe("meteredEmbed", () => {
  test("stores, then records an estimate when the provider reports no usage", async () => {
    useMockModels({ embed: mockEmbeddingModel(2) });
    const { db, admin } = adminWith();
    const stored: number[][][] = [];

    const embeddings = await meteredEmbed(
      admin,
      scope,
      { values: ["a", "b"] },
      async (vectors) => {
        expect(db.tables.ai_usage).toEqual([]);
        stored.push(vectors);
      },
    );

    expect(embeddings).toEqual([
      [0.5, 0.5],
      [0.5, 0.5],
    ]);
    expect(stored).toEqual([embeddings]);
    expect(db.tables.ai_usage).toEqual([
      expect.objectContaining({
        task: "embed",
        model_id: aiTask("embed").model,
        estimated: true,
      }),
    ]);
  });

  test("a reached Daily limit gives null", async () => {
    useMockModels({ embed: mockEmbeddingModel() });
    const { admin } = reachedLimit();

    expect(await meteredEmbed(admin, scope, { values: ["a"] })).toBeNull();
  });
});
