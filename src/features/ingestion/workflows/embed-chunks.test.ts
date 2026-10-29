// @vitest-environment node
import { APICallError } from "ai";
import { MockEmbeddingModelV4 } from "ai/test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { FatalError, RetryableError } from "workflow";
import {
  createParseDb,
  fixture,
  pageModel,
  seedMaterial,
  STUDENT,
  unit,
  useMockModels,
} from "@/features/ingestion/workflows/parse-testing";
import { mockEmbeddingModel } from "@/lib/ai/testing";
import { markAdminClient } from "@/lib/supabase/admin-brand";
import type { Supabase } from "@/lib/supabase/types";

vi.mock("server-only", () => ({}));

let db = createParseDb();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));

const { parseMaterial } = await import("./parse-material");

beforeEach(() => {
  db = createParseDb();
});

const twoPages = () =>
  pageModel([
    { units: [unit({ label: "content", markdown: "Alpha." })] },
    {
      units: [
        unit({ label: "content", markdown: "Beta." }),
        unit({ label: "exercise", markdown: "Gamma." }),
      ],
    },
  ]);

/** An error answer of the Gemini API (see docs/agents/live-ai.md). */
const geminiError = (statusCode: number, error: Record<string, unknown>) =>
  new APICallError({
    message: "Gemini API error",
    url: "https://example.test",
    requestBodyValues: {},
    statusCode,
    responseBody: JSON.stringify({ error: { code: statusCode, ...error } }),
  });

/** The values an embedding model was asked to embed, over all its calls. */
const embeddedValues = (model: MockEmbeddingModelV4) =>
  model.doEmbedCalls.flatMap((call) => call.values);

describe("the embed step of a parse", () => {
  test("stores a vector for every chunk and records estimated usage, as the provider reports none, before the Material is parsed", async () => {
    seedMaterial(db, "application/pdf", await fixture("two-page-lecture.pdf"));
    const embed = mockEmbeddingModel(4);
    useMockModels({ ingest: twoPages().model, embed });

    await parseMaterial(db.tables.materials[0]!.id as string);

    expect(db.tables.chunks).toHaveLength(3);
    for (const chunk of db.tables.chunks) {
      expect(chunk.embedding).toBe("[0.5,0.5,0.5,0.5]");
    }
    expect(embeddedValues(embed).toSorted()).toEqual([
      "Alpha.",
      "Beta.",
      "Gamma.",
    ]);
    expect(db.tables.materials[0]).toMatchObject({ parse_status: "parsed" });
    expect(
      db.tables.ai_usage.filter((row) => row.task === "embed"),
    ).toMatchObject([
      // "Alpha.Beta.Gamma." is 17 characters: 5 tokens at 4 per token.
      {
        owner: STUDENT,
        input_tokens: 5,
        output_tokens: 0,
        estimated: true,
        chat_id: null,
      },
    ]);
  });

  test("embeds the chunks as documents and leaves admin chunks without a vector", async () => {
    seedMaterial(db, "application/pdf", await fixture("two-page-lecture.pdf"));
    const embed = mockEmbeddingModel(4);
    useMockModels({
      ingest: pageModel([
        {
          units: [
            unit({ label: "admin", markdown: "The exam is on 3 March." }),
            unit({ label: "content", markdown: "Alpha." }),
          ],
        },
        { units: [] },
      ]).model,
      embed,
    });

    await parseMaterial(db.tables.materials[0]!.id as string);

    expect(
      db.tables.chunks.map((chunk) => [chunk.label, chunk.embedding ?? null]),
    ).toEqual([
      ["admin", null],
      ["content", "[0.5,0.5,0.5,0.5]"],
    ]);
    expect(embed.doEmbedCalls[0]?.providerOptions).toMatchObject({
      cohere: { inputType: "search_document" },
    });
  });

  test("refuses with the Daily limit reason, embedding nothing, when the limit is reached", async () => {
    seedMaterial(db, "application/pdf", await fixture("two-page-lecture.pdf"));
    const embed = mockEmbeddingModel(4);
    useMockModels({ embed });
    vi.stubEnv("AI_DAILY_LIMIT_USD", "1");
    db.tables.chunks.push({
      id: crypto.randomUUID(),
      material_id: db.tables.materials[0]!.id,
      position: 0,
      label: "content",
      markdown: "Alpha.",
    });
    db.tables.ai_usage.push({
      owner: STUDENT,
      task: "ingest",
      model_id: "google/gemini-3.5-flash-lite",
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      cost_usd: 1000,
      estimated: false,
      chat_id: null,
      created_at: new Date().toISOString(),
    });

    const { embedChunks } = await import("./embed-chunks");
    const outcome = await embedChunks(db.tables.materials[0]!.id as string);

    expect(outcome).toEqual({ ok: false, reason: "Daily limit reached" });
    expect(embed.doEmbedCalls).toHaveLength(0);
  });

  test("a parse started again after a failed embed keeps the chunks and embeds only those without a vector", async () => {
    seedMaterial(db, "application/pdf", await fixture("two-page-lecture.pdf"));
    const { model } = twoPages();
    const embed = mockEmbeddingModel(4);
    useMockModels({ ingest: model, embed });
    await parseMaterial(db.tables.materials[0]!.id as string);

    // The embed step stored a vector for the first chunk, then failed.
    const [first, ...rest] = db.tables.chunks.toSorted(
      (a, b) => Number(a.position) - Number(b.position),
    );
    for (const chunk of rest) delete chunk.embedding;
    const firstId = first!.id;
    db.tables.materials[0]!.parse_status = "failed";
    embed.doEmbedCalls.length = 0;
    const usageBefore = db.tables.ai_usage.length;

    await parseMaterial(db.tables.materials[0]!.id as string);

    expect(db.tables.chunks.map((chunk) => chunk.id)).toContain(firstId);
    expect(embeddedValues(embed).toSorted()).toEqual(["Beta.", "Gamma."]);
    expect(db.tables.chunks.every((chunk) => chunk.embedding)).toBe(true);
    expect(db.tables.materials[0]).toMatchObject({ parse_status: "parsed" });
    expect(db.tables.ai_usage).toHaveLength(usageBefore + 1);
  });

  test("keeps the stored vectors when recording usage fails, so the step's retry embeds nothing again", async () => {
    // The ai_usage insert fails, as the not-null constraint did for NaN.
    db = createParseDb({ canAccess: (table) => table !== "ai_usage" });
    seedMaterial(db, "application/pdf", await fixture("two-page-lecture.pdf"));
    db.tables.chunks.push({
      id: crypto.randomUUID(),
      material_id: db.tables.materials[0]!.id,
      position: 0,
      label: "content",
      markdown: "Alpha.",
    });
    const embed = mockEmbeddingModel(4);
    useMockModels({ embed });
    const { embedChunks } = await import("./embed-chunks");
    const materialId = db.tables.materials[0]!.id as string;

    await expect(embedChunks(materialId)).rejects.toThrow(/AI usage/);
    await embedChunks(materialId);

    expect(db.tables.chunks[0]!.embedding).toBe("[0.5,0.5,0.5,0.5]");
    expect(embed.doEmbedCalls).toHaveLength(1);
  });

  test("a per-minute 429 is one request, and the step retries after the delay the provider asks for", async () => {
    seedMaterial(db, "application/pdf", await fixture("two-page-lecture.pdf"));
    db.tables.chunks.push({
      id: crypto.randomUUID(),
      material_id: db.tables.materials[0]!.id,
      position: 0,
      label: "content",
      markdown: "Alpha.",
    });
    const embed = new MockEmbeddingModelV4({
      doEmbed: async () => {
        throw geminiError(429, {
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.QuotaFailure",
              violations: [
                {
                  quotaId:
                    "EmbedContentRequestsPerMinutePerProjectPerModel-FreeTier",
                },
              ],
            },
            {
              "@type": "type.googleapis.com/google.rpc.RetryInfo",
              retryDelay: "21s",
            },
          ],
        });
      },
    });
    useMockModels({ embed });
    const { embedChunks } = await import("./embed-chunks");

    const failed = await embedChunks(
      db.tables.materials[0]!.id as string,
    ).catch((error: unknown) => error);

    expect(embed.doEmbedCalls).toHaveLength(1);
    expect(RetryableError.is(failed)).toBe(true);
    const waitMs = (failed as RetryableError).retryAfter.getTime() - Date.now();
    expect(waitMs).toBeGreaterThan(19_000);
    expect(waitMs).toBeLessThanOrEqual(21_000);
  });

  test("a request the provider rejects as malformed fails the step without retries", async () => {
    seedMaterial(db, "application/pdf", await fixture("two-page-lecture.pdf"));
    db.tables.chunks.push({
      id: crypto.randomUUID(),
      material_id: db.tables.materials[0]!.id,
      position: 0,
      label: "content",
      markdown: "Alpha.",
    });
    const embed = new MockEmbeddingModelV4({
      doEmbed: async () => {
        throw geminiError(400, { status: "INVALID_ARGUMENT" });
      },
    });
    useMockModels({ embed });
    const { embedChunks } = await import("./embed-chunks");

    const failed = await embedChunks(
      db.tables.materials[0]!.id as string,
    ).catch((error: unknown) => error);

    expect(embed.doEmbedCalls).toHaveLength(1);
    expect(FatalError.is(failed)).toBe(true);
  });

  test("a retry embeds only the chunks without a vector", async () => {
    seedMaterial(db, "application/pdf", await fixture("two-page-lecture.pdf"));
    const embed = mockEmbeddingModel(4);
    useMockModels({ ingest: twoPages().model, embed });
    await parseMaterial(db.tables.materials[0]!.id as string);

    // An earlier embed step stored a vector for the first chunk only.
    const [first, ...rest] = db.tables.chunks.toSorted(
      (a, b) => Number(a.position) - Number(b.position),
    );
    for (const chunk of rest) delete chunk.embedding;
    db.tables.materials[0]!.parse_status = "parsing";
    embed.doEmbedCalls.length = 0;

    const { embedChunks } = await import("./embed-chunks");
    const outcome = await embedChunks(db.tables.materials[0]!.id as string);

    expect(outcome).toEqual({ ok: true });
    expect(embeddedValues(embed).toSorted()).toEqual(["Beta.", "Gamma."]);
    expect(first!.embedding).toBe("[0.5,0.5,0.5,0.5]");
    expect(db.tables.chunks.every((chunk) => chunk.embedding)).toBe(true);
  });
});
