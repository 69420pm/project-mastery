// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  BUCKET,
  COURSE,
  createParseDb,
  fixture,
  MATERIAL,
  pageModel,
  seedMaterial as seedMaterialIn,
  sentImages,
  storedChunks,
  STORAGE_PATH,
  STUDENT,
  unit,
  useMockModels,
} from "@/features/ingestion/workflows/parse-testing";
import { markAdminClient } from "@/lib/supabase/admin-brand";
import type { Supabase } from "@/lib/supabase/types";

vi.mock("server-only", () => ({}));

let db = createParseDb();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));

const { parseMaterial } = await import("./parse-material");

const seedMaterial = (mediaType: string, body: Uint8Array) =>
  seedMaterialIn(db, mediaType, body);

beforeEach(() => {
  db = createParseDb();
});

type Prompt = Array<{ role: string; content: Array<{ text?: string }> }>;

/** The text parts each batch call sent, in order. */
const sentTexts = (prompts: unknown[]) =>
  prompts.map((prompt) =>
    (prompt as Prompt)
      .filter((message) => message.role === "user")
      .flatMap((message) => message.content)
      .flatMap((part) => (typeof part.text === "string" ? [part.text] : [])),
  );

const storedPages = () =>
  db.tables.material_pages
    .toSorted((a, b) => Number(a.page_number) - Number(b.page_number))
    .map((page) => [
      page.page_number,
      page.skipped ?? null,
      (page.units as Array<{ markdown: string }>).map((u) => u.markdown),
    ]);

describe("parsing a PDF Material", () => {
  test("reads its pages in one batch call with each page's number, image and text layer, and stores the units on the pages they start", async () => {
    seedMaterial("application/pdf", await fixture("two-page-lecture.pdf"));
    const { model, prompts } = pageModel([
      {
        units: [
          unit({ markdown: "**Grenzwert.** $\\lim a_n = a$ ...", pageTo: 2 }),
          unit({ label: "admin", markdown: "Nicht prüfungsrelevant." }),
          unit({
            label: "exercise",
            markdown: "Zeige $1/n \\to 0$.",
            pageFrom: 2,
            pageTo: 2,
          }),
        ],
      },
    ]);
    useMockModels({ ingest: model });

    await parseMaterial(MATERIAL);

    expect(sentImages(prompts)).toEqual([["image/jpeg", "image/jpeg"]]);
    expect(sentTexts(prompts)).toEqual([
      [
        "Page 1",
        expect.stringContaining("Definition: limit"),
        "Page 2",
        expect.stringContaining("Example: 1/n to 0"),
      ],
    ]);
    expect(storedPages()).toEqual([
      [
        1,
        null,
        ["**Grenzwert.** $\\lim a_n = a$ ...", "Nicht prüfungsrelevant."],
      ],
      [2, null, ["Zeige $1/n \\to 0$."]],
    ]);
    expect(storedChunks(db)).toEqual([
      {
        position: 0,
        page_from: 1,
        page_to: 2,
        label: "content",
        markdown: "**Grenzwert.** $\\lim a_n = a$ ...",
      },
      expect.objectContaining({ position: 1, label: "admin", page_from: 1 }),
      expect.objectContaining({ position: 2, label: "exercise", page_from: 2 }),
    ]);
    expect(db.tables.chunks[0]).toMatchObject({
      owner: STUDENT,
      course_id: COURSE,
      material_id: MATERIAL,
    });
    expect(db.tables.materials[0]).toMatchObject({
      parse_status: "parsed",
      pages_total: 2,
      pages_done: 2,
    });
    expect(db.tables.ai_usage).toEqual([
      expect.objectContaining({
        owner: STUDENT,
        task: "ingest",
        model_id: "xiaomi/mimo-v2.6-flash",
        input_tokens: 1000,
        output_tokens: 200,
      }),
      expect.objectContaining({ owner: STUDENT, task: "embed" }),
    ]);
    expect(db.files.paths(BUCKET)).toEqual([STORAGE_PATH]);
  });

  test("reads 7 pages in batches of 5 and 2, gives the second the first's last unit, and joins a unit across the batch edge", async () => {
    seedMaterial("application/pdf", await fixture("seven-page-script.pdf"));
    const { model, prompts } = pageModel([
      {
        units: [
          unit({ label: "heading", markdown: "1 Vectors", style: "title" }),
          unit({
            markdown: "A vector space is",
            pageTo: 5,
            continuesOnNextBatch: true,
          }),
        ],
      },
      {
        units: [
          unit({
            markdown: "a set with addition.",
            pageFrom: 6,
            pageTo: 6,
            continuesFromPreviousBatch: true,
          }),
          unit({
            label: "exercise",
            markdown: "Show it.",
            pageFrom: 7,
            pageTo: 7,
          }),
        ],
      },
    ]);
    useMockModels({ ingest: model });

    await parseMaterial(MATERIAL);

    expect(sentImages(prompts).map((images) => images.length)).toEqual([5, 2]);
    expect(sentTexts(prompts)[1]![0]).toContain("A vector space is");
    expect(storedChunks(db)).toEqual([
      {
        position: 0,
        page_from: 1,
        page_to: 6,
        label: "content",
        markdown: "**1 Vectors**\n\nA vector space is\n\na set with addition.",
      },
      {
        position: 1,
        page_from: 7,
        page_to: 7,
        label: "exercise",
        markdown: "Show it.",
      },
    ]);
    expect(db.tables.materials[0]).toMatchObject({
      parse_status: "parsed",
      pages_done: 7,
    });
  });

  test("skips a slide overlay and a blank page without a call", async () => {
    seedMaterial("application/pdf", await fixture("slides-with-blank.pdf"));
    const { model, prompts } = pageModel([
      { units: [unit({ markdown: "Vectors add up.", pageFrom: 2 })] },
    ]);
    useMockModels({ ingest: model });

    await parseMaterial(MATERIAL);

    expect(sentImages(prompts)).toEqual([["image/jpeg"]]);
    expect(storedPages()).toEqual([
      [1, "overlay", []],
      [2, null, ["Vectors add up."]],
      [3, "blank", []],
    ]);
    expect(db.tables.materials[0]).toMatchObject({
      parse_status: "parsed",
      pages_total: 3,
      pages_done: 3,
    });
  });
});

describe("parsing an image Material", () => {
  test("parses the uploaded image as its one page, without rendering or a text layer", async () => {
    const png = await readFile(
      path.join(import.meta.dirname, "test-files", "whiteboard.png"),
    );
    seedMaterial("image/png", png);
    const { model, prompts } = pageModel([
      { units: [unit({ markdown: "$x^2$" })] },
    ]);
    useMockModels({ ingest: model });

    await parseMaterial(MATERIAL);

    expect(db.tables.materials[0]).toMatchObject({
      parse_status: "parsed",
      pages_total: 1,
      pages_done: 1,
    });
    expect(db.tables.chunks).toEqual([
      expect.objectContaining({ page_from: 1, page_to: 1, markdown: "$x^2$" }),
    ]);
    expect(sentImages(prompts)).toEqual([["image/png"]]);
    expect(sentTexts(prompts)).toEqual([["Page 1"]]);
  });
});

describe("the Daily limit", () => {
  test("is checked before each batch call, and a reached limit fails the parse with that reason", async () => {
    vi.stubEnv("AI_DAILY_LIMIT_USD", "1");
    db.tables.ai_usage.push({
      owner: STUDENT,
      task: "chat",
      cost_usd: 5,
      created_at: new Date().toISOString(),
    });
    seedMaterial("application/pdf", await fixture("two-page-lecture.pdf"));
    const { model, prompts } = pageModel([]);
    useMockModels({ ingest: model });

    await parseMaterial(MATERIAL);

    expect(prompts).toHaveLength(0);
    expect(db.tables.materials[0]).toMatchObject({
      parse_status: "failed",
      parse_failure: "Daily limit reached",
    });
    expect(db.tables.material_pages).toEqual([]);
  });
});
