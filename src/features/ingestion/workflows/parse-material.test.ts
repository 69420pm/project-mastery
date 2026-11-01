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
      expect.objectContaining({ owner: STUDENT, task: "ingest" }),
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

describe("the Outline", () => {
  const units = [
    unit({ label: "heading", markdown: "4 Vector Spaces", style: "title" }),
    unit({ markdown: "Intro to vector spaces." }),
    unit({ label: "heading", markdown: "4.1 Subspaces", pageFrom: 2 }),
    unit({
      label: "heading",
      markdown: "Lemma 4.1.2",
      style: "bold",
      pageFrom: 2,
    }),
    unit({ markdown: "A subspace is closed.", pageFrom: 2, pageTo: 2 }),
  ];

  test("comes from one structure call over the headings and page starts, and the chunks are cut at its Chapters", async () => {
    seedMaterial("application/pdf", await fixture("two-page-lecture.pdf"));
    const { model, outlinePrompts } = pageModel([{ units }], undefined, () => ({
      language: "English",
      notes: "Vectors are rows.",
      chapters: [
        {
          title: "4 Vector Spaces",
          level: 1,
          heading: "h1",
          page: null,
          exam: false,
        },
        {
          title: "4.1 Subspaces",
          level: 2,
          heading: "h2",
          page: null,
          exam: false,
        },
        {
          title: "Lemma 4.1.2",
          level: 3,
          heading: "h9",
          page: null,
          exam: false,
        },
      ],
    }));
    useMockModels({ ingest: model });

    await parseMaterial(MATERIAL);

    expect(outlinePrompts).toEqual([
      {
        material: "Lecture 1",
        pages: 2,
        headings: [
          { id: "h1", page: 1, style: "title", text: "4 Vector Spaces" },
          { id: "h2", page: 2, style: null, text: "4.1 Subspaces" },
          { id: "h3", page: 2, style: "bold", text: "Lemma 4.1.2" },
        ],
        pageStarts: [
          { page: 1, text: "4 Vector Spaces Intro to vector spaces." },
          { page: 2, text: "4.1 Subspaces Lemma 4.1.2 A subspace is closed." },
        ],
      },
    ]);
    const chapters = db.tables.chapters.toSorted(
      (a, b) => Number(a.position) - Number(b.position),
    );
    expect(
      chapters.map((c) => [c.title, c.depth, c.page_from, c.material_id]),
    ).toEqual([
      ["Lecture 1", 0, 1, MATERIAL],
      ["4 Vector Spaces", 1, 1, MATERIAL],
      ["4.1 Subspaces", 2, 2, MATERIAL],
    ]);
    expect(chapters.map((c) => c.parent_id)).toEqual([
      null,
      chapters[0]!.id,
      chapters[1]!.id,
    ]);
    const chapterOf = (id: unknown) =>
      chapters.find((chapter) => chapter.id === id)?.title;
    expect(
      db.tables.chunks.map((c) => [chapterOf(c.chapter_id), c.markdown]),
    ).toEqual([
      ["4 Vector Spaces", "# 4 Vector Spaces\n\nIntro to vector spaces."],
      [
        "4.1 Subspaces",
        "## 4.1 Subspaces\n\n**Lemma 4.1.2**\n\nA subspace is closed.",
      ],
    ]);
    expect(db.tables.materials[0]).toMatchObject({
      parse_status: "parsed",
      language: "English",
      notes: "Vectors are rows.",
    });
  });

  test("when the structure call gives no valid answer, has only the root Chapter without a PDF outline, and the parse goes on", async () => {
    seedMaterial("application/pdf", await fixture("two-page-lecture.pdf"));
    const { model } = pageModel([{ units }], undefined, () => ({
      chapters: "nope",
    }));
    useMockModels({ ingest: model });

    await parseMaterial(MATERIAL);

    expect(db.tables.chapters).toEqual([
      expect.objectContaining({
        title: "Lecture 1",
        depth: 0,
        parent_id: null,
      }),
    ]);
    expect(db.tables.chunks.map((c) => c.markdown)).toEqual([
      "**4 Vector Spaces**\n\nIntro to vector spaces.",
      "**4.1 Subspaces**\n\n**Lemma 4.1.2**\n\nA subspace is closed.",
    ]);
    expect(db.tables.materials[0]).toMatchObject({
      parse_status: "parsed",
      language: null,
      notes: null,
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
