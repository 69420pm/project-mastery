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

/** The text hint each page call sent, or null without one. */
const sentTexts = (prompts: unknown[]) =>
  prompts.map(
    (prompt) =>
      (prompt as Prompt)
        .flatMap((message) => message.content)
        .find((part) => typeof part.text === "string")?.text ?? null,
  );

describe("parsing a PDF Material", () => {
  test("turns every page's units into chunks with labels and pages, and ends parsed with the pages' language", async () => {
    seedMaterial("application/pdf", await fixture("two-page-lecture.pdf"));
    const { model, prompts } = pageModel([
      {
        language: "de",
        units: [
          unit({ markdown: "**Grenzwert.** $\\lim a_n = a$ ..." }),
          unit({ label: "admin", markdown: "Nicht prüfungsrelevant." }),
        ],
      },
      {
        language: "de",
        units: [
          unit({
            label: "exercise",
            markdown: "Zeige $1/n \\to 0$.",
            exerciseNumber: "1.2",
          }),
        ],
      },
    ]);
    useMockModels({ ingest: model });

    await parseMaterial(MATERIAL);

    expect(db.tables.materials[0]).toMatchObject({
      parse_status: "parsed",
      pages_total: 2,
      pages_done: 2,
      language: "de",
    });
    const owned = { owner: STUDENT, course_id: COURSE, material_id: MATERIAL };
    expect(
      db.tables.chunks.toSorted(
        (a, b) => Number(a.position) - Number(b.position),
      ),
    ).toEqual([
      expect.objectContaining({
        ...owned,
        position: 0,
        page_from: 1,
        page_to: 1,
        label: "content",
        markdown: "**Grenzwert.** $\\lim a_n = a$ ...",
        exercise_number: null,
      }),
      expect.objectContaining({ position: 1, label: "admin", page_from: 1 }),
      expect.objectContaining({
        position: 2,
        page_from: 2,
        label: "exercise",
        exercise_number: "1.2",
      }),
    ]);
    // One vision call per page, each with its page rendered as JPEG and its
    // text layer as a hint.
    expect(sentImages(prompts)).toEqual([["image/jpeg"], ["image/jpeg"]]);
    expect(sentTexts(prompts)).toEqual([
      expect.stringContaining("Definition: limit"),
      expect.stringContaining("Example: 1/n to 0"),
    ]);
  });

  test("joins a unit continued on the next page, and stores every non-admin chunk in a Part", async () => {
    seedMaterial("application/pdf", await fixture("two-page-lecture.pdf"));
    useMockModels({
      ingest: pageModel([
        {
          units: [
            unit({
              markdown: "# Limits\n\nA sequence converges when",
              continuesOnNextPage: true,
            }),
            unit({ label: "admin", markdown: "Exam on 3 March." }),
          ],
        },
        {
          units: [
            unit({ markdown: "its terms approach a limit." }),
            unit({
              label: "exercise",
              markdown: "Show it.",
              exerciseNumber: "1.2",
            }),
          ],
        },
      ]).model,
    });

    await parseMaterial(MATERIAL);

    const chunks = db.tables.chunks.toSorted(
      (a, b) => Number(a.position) - Number(b.position),
    );
    const parts = db.tables.parts.toSorted(
      (a, b) => Number(a.position) - Number(b.position),
    );
    expect(
      chunks.map((chunk) => [chunk.label, chunk.page_from, chunk.page_to]),
    ).toEqual([
      ["content", 1, 2],
      ["admin", 1, 1],
      ["exercise", 2, 2],
    ]);
    expect(parts).toEqual([
      expect.objectContaining({
        position: 0,
        kind: "teaching",
        title: "Limits",
        chapter_title: "Limits",
        page_from: 1,
        page_to: 2,
        content_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
      expect.objectContaining({ position: 1, kind: "exercise", title: "1.2" }),
    ]);
    expect(chunks.map((chunk) => chunk.part_id)).toEqual([
      parts[0]!.id,
      null,
      parts[1]!.id,
    ]);
    expect(db.tables.materials[0]).toMatchObject({ parse_status: "parsed" });
  });

  test("stores each page's result and language, and no page image in Storage", async () => {
    seedMaterial("application/pdf", await fixture("two-page-lecture.pdf"));
    useMockModels({
      ingest: pageModel([
        { units: [unit({ markdown: "Page one" })] },
        { units: [unit({ markdown: "Page two" })] },
      ]).model,
    });

    await parseMaterial(MATERIAL);

    const pages = db.tables.material_pages.toSorted(
      (a, b) => Number(a.page_number) - Number(b.page_number),
    );
    expect(pages).toEqual(
      [1, 2].map((page) =>
        expect.objectContaining({
          owner: STUDENT,
          material_id: MATERIAL,
          page_number: page,
          language: "en",
          units: [
            expect.objectContaining({
              markdown: `Page ${["one", "two"][page - 1]}`,
            }),
          ],
        }),
      ),
    );
    expect(db.files.paths(BUCKET)).toEqual([STORAGE_PATH]);
  });

  test("records the usage of every page call for the Student", async () => {
    seedMaterial("application/pdf", await fixture("two-page-lecture.pdf"));
    useMockModels({
      ingest: pageModel([
        { units: [unit({ markdown: "One" })] },
        { units: [unit({ markdown: "Two" })] },
      ]).model,
    });

    await parseMaterial(MATERIAL);

    expect(db.tables.ai_usage).toEqual([
      expect.objectContaining({
        owner: STUDENT,
        task: "ingest",
        model_id: "xiaomi/mimo-v2.6-flash",
        input_tokens: 1000,
        output_tokens: 200,
      }),
      expect.objectContaining({ owner: STUDENT, task: "ingest" }),
      expect.objectContaining({ owner: STUDENT, task: "embed" }),
    ]);
  });

  test("skips a slide overlay and a blank page without a call", async () => {
    seedMaterial("application/pdf", await fixture("slides-with-blank.pdf"));
    const { model, prompts } = pageModel([
      { units: [unit({ markdown: "Vectors add up." })] },
    ]);
    useMockModels({ ingest: model });

    await parseMaterial(MATERIAL);

    expect(prompts).toHaveLength(1);
    expect(
      db.tables.material_pages
        .toSorted((a, b) => Number(a.page_number) - Number(b.page_number))
        .map((page) => [page.page_number, page.skipped ?? null, page.units]),
    ).toEqual([
      [1, "overlay", []],
      [2, null, [expect.objectContaining({ markdown: "Vectors add up." })]],
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
  test("parses the uploaded image as its one page, without rendering or a text hint", async () => {
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
    expect(sentTexts(prompts)).toEqual([null]);
    expect(db.files.paths(BUCKET)).toEqual([STORAGE_PATH]);
  });
});

describe("the Daily limit", () => {
  test("is checked before each page call, and a reached limit fails the parse with that reason", async () => {
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
