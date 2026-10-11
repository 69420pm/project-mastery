// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useMockModels } from "@/lib/ai/testing";
import { markAdminClient } from "@/lib/supabase/admin-brand";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";
import type { Supabase } from "@/lib/supabase/types";

/**
 * How a parse fails, resumes and stops: the parse workflow in-process on
 * the admin client's tables and Storage, with a mock page model.
 */

vi.mock("server-only", () => ({}));

const STUDENT = "11111111-1111-1111-1111-111111111111";
const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const MATERIAL = "aaaaaaaa-0000-4000-8000-000000000001";
const STORAGE_PATH = `${STUDENT}/${COURSE}/${MATERIAL}`;
const BUCKET = "course-files";

function createDb() {
  return fakeSupabase({
    tables: {
      materials: [] as FakeRow[],
      material_pages: [] as FakeRow[],
      chunks: [] as FakeRow[],
      ai_usage: [] as FakeRow[],
    },
    foreignKeys: {
      material_pages: { material_id: "materials" },
      chunks: { material_id: "materials" },
    },
    userId: STUDENT,
    defaults: {
      ai_usage: () => ({ created_at: new Date().toISOString() }),
    },
  });
}

let db = createDb();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));

const { parseMaterial } = await import("./parse-material");
const { readPage } = await import("./parse-steps");

beforeEach(() => {
  db = createDb();
});

async function seedLecture() {
  const body = await readFile(
    path.join(import.meta.dirname, "test-files", "two-page-lecture.pdf"),
  );
  db.tables.materials.push({
    id: MATERIAL,
    owner: STUDENT,
    course_id: COURSE,
    name: "Lecture 1",
    media_type: "application/pdf",
    size_bytes: body.byteLength,
    storage_path: STORAGE_PATH,
    parse_status: "queued",
    pages_total: null,
    pages_done: 0,
    parse_failure: null,
  });
  db.files.seed(BUCKET, STORAGE_PATH, {
    body,
    contentType: "application/pdf",
  });
}

/** What the Student's delete leaves: no rows, and no files of the Material. */
function deleteMaterial() {
  db.tables.materials = [];
  db.tables.material_pages = [];
  db.tables.chunks = [];
  for (const file of db.files.paths(BUCKET)) {
    if (file.startsWith(STORAGE_PATH)) {
      void db.storage.from(BUCKET).remove([file]);
    }
  }
}

const pageResult = (markdown: string) => ({
  units: [
    {
      markdown,
      label: "content",
      exerciseNumber: null,
      points: null,
      figure: null,
      continuesFromPreviousPage: false,
      continuesOnNextPage: false,
    },
  ],
});

type Answer = { units: unknown[] } | Error;

/**
 * A page model that answers the n-th call with `answers[n]`: a page result,
 * or an error it throws. It counts its calls.
 */
function pageModel(answers: Answer[], onCall?: (call: number) => void) {
  let calls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      const answer = answers[calls++] ?? { units: [] };
      onCall?.(calls);
      if (answer instanceof Error) throw answer;
      return {
        content: [{ type: "text", text: JSON.stringify(answer) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: {
            total: 1000,
            noCache: 1000,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 200, text: 200, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { model, calls: () => calls };
}

const material = () => db.tables.materials[0];

describe("a page that cannot be read", () => {
  test("fails the parse with a reason that names the page", async () => {
    await seedLecture();
    useMockModels({
      ingest: pageModel([pageResult("Page one"), new Error("bad output")])
        .model,
    });

    await parseMaterial(MATERIAL);

    expect(material()).toMatchObject({
      parse_status: "failed",
      parse_failure: "The AI could not read page 2",
      pages_done: 1,
    });
    expect(db.tables.chunks).toEqual([]);
  });

  test("a retry reads only the missing page and finishes the parse", async () => {
    await seedLecture();
    useMockModels({
      ingest: pageModel([pageResult("Page one"), new Error("bad output")])
        .model,
    });
    await parseMaterial(MATERIAL);

    const retried = pageModel([pageResult("Page two")]);
    useMockModels({ ingest: retried.model });
    await parseMaterial(MATERIAL);

    expect(retried.calls()).toBe(1);
    expect(material()).toMatchObject({
      parse_status: "parsed",
      parse_failure: null,
      pages_total: 2,
      pages_done: 2,
    });
    expect(
      db.tables.chunks.map((chunk) => [chunk.page_from, chunk.markdown]),
    ).toEqual([
      [1, "Page one"],
      [2, "Page two"],
    ]);
    expect(db.tables.ai_usage).toHaveLength(2);
  });
});

describe("a file that cannot be opened", () => {
  test("fails the parse with that reason, without a model call", async () => {
    await seedLecture();
    db.files.seed(BUCKET, STORAGE_PATH, {
      body: "not a pdf",
      contentType: "application/pdf",
    });
    const model = pageModel([]);
    useMockModels({ ingest: model.model });

    await parseMaterial(MATERIAL);

    expect(model.calls()).toBe(0);
    expect(material()).toMatchObject({
      parse_status: "failed",
      parse_failure: "The file could not be opened",
    });
  });
});

describe("the daily quota of the model provider", () => {
  test("a 429 for the daily quota fails the parse as a Daily limit, with no further calls", async () => {
    await seedLecture();
    const model = pageModel([
      new APICallError({
        message: "Quota exceeded",
        url: "https://example.test",
        requestBodyValues: {},
        statusCode: 429,
        responseBody: JSON.stringify({
          error: {
            code: 429,
            status: "RESOURCE_EXHAUSTED",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                violations: [
                  {
                    quotaId:
                      "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
                  },
                ],
              },
            ],
          },
        }),
        isRetryable: false,
      }),
    ]);
    useMockModels({ ingest: model.model });

    await parseMaterial(MATERIAL);

    expect(model.calls()).toBe(1);
    expect(material()).toMatchObject({
      parse_status: "failed",
      parse_failure: "Daily limit reached",
    });
  });
});

describe("deleting the Material while it parses", () => {
  test("stops the parse quietly and leaves no rows or files behind", async () => {
    await seedLecture();
    // Page one has a figure, whose crop is stored after the delete.
    const withFigure = {
      units: [
        {
          ...pageResult("Plot of $y = x^2$").units[0],
          label: "figure",
          figure: {
            description: "A parabola.",
            box: { x: 0.1, y: 0.2, width: 0.5, height: 0.25 },
          },
        },
      ],
    };
    const model = pageModel([withFigure, pageResult("Page two")], (call) => {
      if (call === 1) deleteMaterial();
    });
    useMockModels({ ingest: model.model });

    await parseMaterial(MATERIAL);

    expect(model.calls()).toBe(1);
    expect(db.tables.materials).toEqual([]);
    expect(db.tables.material_pages).toEqual([]);
    expect(db.tables.chunks).toEqual([]);
    expect(db.files.paths(BUCKET)).toEqual([]);
  });

  test("while its pages are rendered, removes the page images stored after the delete", async () => {
    await seedLecture();
    const model = pageModel([]);
    useMockModels({ ingest: model.model });
    // The Student deletes the Material once its first page image is stored.
    const from = db.storage.from;
    db.storage.from = (bucket: string) => {
      const store = from(bucket);
      return {
        ...store,
        upload: async (...args: Parameters<typeof store.upload>) => {
          const result = await store.upload(...args);
          if (args[0].endsWith("/pages/1.png")) deleteMaterial();
          return result;
        },
      };
    };

    await parseMaterial(MATERIAL);

    expect(model.calls()).toBe(0);
    expect(db.tables.materials).toEqual([]);
    expect(db.files.paths(BUCKET)).toEqual([]);
  });
});

describe("a started parse", () => {
  test("leaves `queued` before its pages render, so Parse is not offered while it runs", async () => {
    await seedLecture();
    useMockModels({ ingest: pageModel([]).model });
    const statuses: unknown[] = [];
    const from = db.storage.from;
    db.storage.from = (bucket: string) => {
      const store = from(bucket);
      return {
        ...store,
        upload: async (...args: Parameters<typeof store.upload>) => {
          statuses.push(material()?.parse_status);
          return store.upload(...args);
        },
      };
    };

    await parseMaterial(MATERIAL);

    expect(statuses).toEqual(["parsing", "parsing"]);
  });
});

describe("a page step that runs again after it stored its page", () => {
  test("neither calls the model nor records usage again, and keeps one page result", async () => {
    await seedLecture();
    const page = {
      pageNumber: 1,
      imagePath: STORAGE_PATH,
      mediaType: "application/pdf",
    };
    const model = pageModel([pageResult("Page one"), pageResult("Again")]);
    useMockModels({ ingest: model.model });

    const first = await readPage(MATERIAL, page);
    const retried = await readPage(MATERIAL, page);

    expect([first, retried]).toEqual([{ ok: true }, { ok: true }]);
    expect(model.calls()).toBe(1);
    expect(db.tables.ai_usage).toHaveLength(1);
    expect(db.tables.material_pages).toEqual([
      expect.objectContaining({ page_number: 1 }),
    ]);
    expect(material()).toMatchObject({ pages_done: 1 });
  });
});
