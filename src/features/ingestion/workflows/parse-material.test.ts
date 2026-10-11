// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useMockModels } from "@/lib/ai/testing";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

vi.mock("server-only", () => ({}));

const STUDENT = "11111111-1111-1111-1111-111111111111";
const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const MATERIAL = "aaaaaaaa-0000-4000-8000-000000000001";
const STORAGE_PATH = `${STUDENT}/${COURSE}/${MATERIAL}`;
const BUCKET = "course-files";

/** The admin client a workflow has: no session, no Row Level Security. */
function createDb() {
  return fakeSupabase({
    tables: {
      materials: [] as FakeRow[],
      material_pages: [] as FakeRow[],
      chunks: [] as FakeRow[],
      ai_usage: [] as FakeRow[],
    },
    // The fake's Storage lets this user write their folder.
    userId: STUDENT,
    defaults: {
      ai_usage: () => ({ created_at: new Date().toISOString() }),
    },
  });
}

let db = createDb();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));

const { parseMaterial } = await import("./parse-material");

const fixture = (name: string) =>
  readFile(path.join(import.meta.dirname, "test-files", name));

function seedMaterial(mediaType: string, body: Uint8Array) {
  db.tables.materials.push({
    id: MATERIAL,
    owner: STUDENT,
    course_id: COURSE,
    name: "Lecture 1",
    media_type: mediaType,
    size_bytes: body.byteLength,
    storage_path: STORAGE_PATH,
    parse_status: "queued",
    pages_total: null,
    pages_done: 0,
  });
  db.files.seed(BUCKET, STORAGE_PATH, { body, contentType: mediaType });
}

const unit = (overrides: Record<string, unknown>) => ({
  markdown: "",
  label: "content",
  exerciseNumber: null,
  points: null,
  figure: null,
  continuesFromPreviousPage: false,
  continuesOnNextPage: false,
  ...overrides,
});

/**
 * A page model that answers each call with the next canned page result, and
 * remembers what it was sent.
 */
function pageModel(pages: Array<{ units: unknown[] }>) {
  const prompts: unknown[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      prompts.push(prompt);
      const page = pages[prompts.length - 1] ?? { units: [] };
      return {
        content: [{ type: "text", text: JSON.stringify(page) }],
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
  return { model, prompts };
}

/** The image parts each call sent, as media types. */
function sentImages(prompts: unknown[]) {
  return prompts.map((prompt) =>
    (prompt as Array<{ role: string; content: unknown }>)
      .filter((message) => message.role === "user")
      .flatMap((message) => message.content as Array<{ type: string }>)
      .filter((part) => part.type === "file")
      .map((part) => (part as unknown as { mediaType: string }).mediaType),
  );
}

beforeEach(() => {
  db = createDb();
});

describe("parsing a PDF Material", () => {
  test("turns every page's units into chunks with labels and pages, and ends parsed", async () => {
    seedMaterial("application/pdf", await fixture("two-page-lecture.pdf"));
    const { model, prompts } = pageModel([
      {
        units: [
          unit({
            label: "definition",
            markdown: "**Limit.** $\\lim_{n\\to\\infty} a_n = a$ if ...",
          }),
          unit({ label: "admin", markdown: "Not exam-relevant." }),
        ],
      },
      {
        units: [
          unit({
            label: "exercise",
            markdown: "Show that $1/n \\to 0$.",
            exerciseNumber: "1.2",
            points: 4,
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
    });
    const chunks = db.tables.chunks
      .toSorted((a, b) => Number(a.position) - Number(b.position))
      .map((chunk) => ({
        owner: chunk.owner,
        course_id: chunk.course_id,
        material_id: chunk.material_id,
        position: chunk.position,
        page_from: chunk.page_from,
        page_to: chunk.page_to,
        label: chunk.label,
        markdown: chunk.markdown,
        exercise_number: chunk.exercise_number,
        points: chunk.points,
      }));
    const owned = { owner: STUDENT, course_id: COURSE, material_id: MATERIAL };
    expect(chunks).toEqual([
      {
        ...owned,
        position: 0,
        page_from: 1,
        page_to: 1,
        label: "definition",
        markdown: "**Limit.** $\\lim_{n\\to\\infty} a_n = a$ if ...",
        exercise_number: null,
        points: null,
      },
      {
        ...owned,
        position: 1,
        page_from: 1,
        page_to: 1,
        label: "admin",
        markdown: "Not exam-relevant.",
        exercise_number: null,
        points: null,
      },
      {
        ...owned,
        position: 2,
        page_from: 2,
        page_to: 2,
        label: "exercise",
        markdown: "Show that $1/n \\to 0$.",
        exercise_number: "1.2",
        points: 4,
      },
    ]);
    // One vision call per page, each with its rendered page image.
    expect(sentImages(prompts)).toEqual([["image/png"], ["image/png"]]);
  });

  test("stores each rendered page as a PNG under the Material's path, with its page result", async () => {
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
    expect(pages).toEqual([
      expect.objectContaining({
        owner: STUDENT,
        material_id: MATERIAL,
        page_number: 1,
        units: [expect.objectContaining({ markdown: "Page one" })],
      }),
      expect.objectContaining({
        owner: STUDENT,
        material_id: MATERIAL,
        page_number: 2,
        units: [expect.objectContaining({ markdown: "Page two" })],
      }),
    ]);
    for (const page of pages) {
      const image = db.files.read(BUCKET, String(page.image_path));
      expect(String(page.image_path)).toMatch(new RegExp(`^${STORAGE_PATH}/`));
      expect(image?.contentType).toBe("image/png");
      // PNG signature
      expect(image?.text.slice(1, 4)).toBe("PNG");
    }
  });

  test("records the usage of every page call for the Student", async () => {
    seedMaterial("application/pdf", await fixture("two-page-lecture.pdf"));
    useMockModels({
      ingest: pageModel([{ units: [] }, { units: [] }]).model,
    });

    await parseMaterial(MATERIAL);

    expect(db.tables.ai_usage).toEqual([
      expect.objectContaining({
        owner: STUDENT,
        task: "ingest",
        model_id: "google/gemini-3.5-flash-lite",
        input_tokens: 1000,
        output_tokens: 200,
      }),
      expect.objectContaining({ owner: STUDENT, task: "ingest" }),
    ]);
  });
});

describe("parsing an image Material", () => {
  test("parses the uploaded image as its one page, without rendering", async () => {
    const png = await readFile(
      path.join(process.cwd(), "e2e", "files", "whiteboard.png"),
    );
    seedMaterial("image/png", png);
    const { model, prompts } = pageModel([
      { units: [unit({ label: "example", markdown: "$x^2$" })] },
    ]);
    useMockModels({ ingest: model });

    await parseMaterial(MATERIAL);

    expect(db.tables.materials[0]).toMatchObject({
      parse_status: "parsed",
      pages_total: 1,
      pages_done: 1,
    });
    expect(db.tables.material_pages).toEqual([
      expect.objectContaining({ page_number: 1, image_path: STORAGE_PATH }),
    ]);
    expect(db.tables.chunks).toEqual([
      expect.objectContaining({
        page_from: 1,
        page_to: 1,
        label: "example",
        markdown: "$x^2$",
      }),
    ]);
    expect(sentImages(prompts)).toEqual([["image/png"]]);
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
    const { model, prompts } = pageModel([{ units: [] }, { units: [] }]);
    useMockModels({ ingest: model });

    await parseMaterial(MATERIAL);

    expect(prompts).toHaveLength(0);
    expect(db.tables.materials[0]).toMatchObject({
      parse_status: "failed",
      parse_failure: "Daily limit reached",
    });
    expect(db.tables.chunks).toEqual([]);
  });
});
