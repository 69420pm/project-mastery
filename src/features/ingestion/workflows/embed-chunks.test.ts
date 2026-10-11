// @vitest-environment node
import { MockEmbeddingModelV4 } from "ai/test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  createParseDb,
  fixture,
  pageModel,
  seedMaterial,
  STUDENT,
  unit,
} from "@/features/ingestion/workflows/parse-testing";
import { mockEmbeddingModel, useMockModels } from "@/lib/ai/testing";
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
        unit({ label: "example", markdown: "Beta." }),
        unit({ label: "exercise", markdown: "Gamma." }),
      ],
    },
  ]);

/** The values an embedding model was asked to embed, over all its calls. */
const embeddedValues = (model: MockEmbeddingModelV4) =>
  model.doEmbedCalls.flatMap((call) => call.values);

describe("the embed step of a parse", () => {
  test("stores a vector for every chunk and records usage before the Material is parsed", async () => {
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
      { owner: STUDENT, input_tokens: 3, output_tokens: 0, chat_id: null },
    ]);
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
    const { model, filePrompts } = twoPages();
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

    expect(filePrompts).toHaveLength(1);
    expect(db.tables.chunks.map((chunk) => chunk.id)).toContain(firstId);
    expect(embeddedValues(embed).toSorted()).toEqual(["Beta.", "Gamma."]);
    expect(db.tables.chunks.every((chunk) => chunk.embedding)).toBe(true);
    expect(db.tables.materials[0]).toMatchObject({ parse_status: "parsed" });
    expect(db.tables.ai_usage).toHaveLength(usageBefore + 1);
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
