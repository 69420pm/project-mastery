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
} from "@/features/ingestion/workflows/parse-testing";
import { useMockModels } from "@/lib/ai/testing";
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

  test("records the usage of every page call and the file call for the Student", async () => {
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
        model_id: "google/gemini-3.5-flash-lite",
        input_tokens: 1000,
        output_tokens: 200,
      }),
      expect.objectContaining({ owner: STUDENT, task: "ingest" }),
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
