// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  COURSE,
  createParseDb,
  fixture,
  MATERIAL,
  pageModel,
  seedMaterial,
  sentUnits,
  storedChunks,
  STUDENT,
  unit,
  type CannedFileResult,
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

type FileChunk = CannedFileResult["chunks"][number];

/** A chunk of a canned file result, with no exercise number or points. */
const chunk = (
  unitIds: string[],
  label: string,
  more: Partial<FileChunk> = {},
): FileChunk => ({
  unitIds,
  label,
  exerciseNumber: null,
  points: null,
  ...more,
});

beforeEach(() => {
  db = createParseDb();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the file call of a parse", () => {
  test("merges a section that runs over a page break into one chunk with a page range", async () => {
    seedMaterial(db, "application/pdf", await fixture("two-page-lecture.pdf"));
    const { model, filePrompts } = pageModel(
      [
        {
          units: [
            unit({ label: "admin", markdown: "Not exam-relevant." }),
            unit({
              label: "definition",
              markdown: "**Limit.** A sequence $a_n$ converges to $a$",
              continuesOnNextPage: true,
            }),
          ],
        },
        {
          units: [
            unit({
              label: "definition",
              markdown: "if $|a_n - a| < \\varepsilon$ for all large $n$.",
              continuesFromPreviousPage: true,
            }),
            unit({ label: "example", markdown: "$1/n \\to 0$." }),
          ],
        },
      ],
      {
        chunks: [
          chunk(["p1u1"], "admin"),
          chunk(["p1u2", "p2u1"], "definition"),
          chunk(["p2u2"], "example"),
        ],
        exam: null,
      },
    );
    useMockModels({ ingest: model });

    await parseMaterial(MATERIAL);

    expect(db.tables.materials[0]).toMatchObject({ parse_status: "parsed" });
    expect(storedChunks(db)).toEqual([
      {
        position: 0,
        page_from: 1,
        page_to: 1,
        label: "admin",
        markdown: "Not exam-relevant.",
        exercise_number: null,
        points: null,
      },
      {
        position: 1,
        page_from: 1,
        page_to: 2,
        label: "definition",
        markdown:
          "**Limit.** A sequence $a_n$ converges to $a$\n\nif $|a_n - a| < \\varepsilon$ for all large $n$.",
        exercise_number: null,
        points: null,
      },
      {
        position: 2,
        page_from: 2,
        page_to: 2,
        label: "example",
        markdown: "$1/n \\to 0$.",
        exercise_number: null,
        points: null,
      },
    ]);
    // One text call over all units, by id with their pages and labels.
    expect(filePrompts).toHaveLength(1);
    expect(
      sentUnits(filePrompts[0]).map(({ id, page, label }) => ({
        id,
        page,
        label,
      })),
    ).toEqual([
      { id: "p1u1", page: 1, label: "admin" },
      { id: "p1u2", page: 1, label: "definition" },
      { id: "p2u1", page: 2, label: "definition" },
      { id: "p2u2", page: 2, label: "example" },
    ]);
  });

  test("splits an exercise into its subtasks, each with its number and points", async () => {
    seedMaterial(db, "application/pdf", await fixture("exercise-sheet.pdf"));
    const { model } = pageModel(
      [
        {
          units: [
            unit({
              label: "exercise",
              markdown: "**Exercise 7.2** (6 points) Let $f(x) = x^2$.",
              exerciseNumber: "7.2",
              points: 6,
            }),
            unit({
              label: "exercise",
              markdown: "a) Compute $f'(x)$. (2 points)",
              exerciseNumber: "a",
              points: 2,
            }),
            unit({
              label: "exercise",
              markdown: "b) Find the minimum of $f$. (4 points)",
              exerciseNumber: "b",
              points: 4,
            }),
          ],
        },
      ],
      {
        chunks: [
          chunk(["p1u1"], "exercise", { exerciseNumber: "7.2", points: 6 }),
          chunk(["p1u2"], "exercise", { exerciseNumber: "7.2a", points: 2 }),
          chunk(["p1u3"], "exercise", { exerciseNumber: "7.2b", points: 4 }),
        ],
        exam: null,
      },
    );
    useMockModels({ ingest: model });

    await parseMaterial(MATERIAL);

    expect(
      storedChunks(db).map(({ label, exercise_number, points, markdown }) => ({
        label,
        exercise_number,
        points,
        markdown,
      })),
    ).toEqual([
      {
        label: "exercise",
        exercise_number: "7.2",
        points: 6,
        markdown: "**Exercise 7.2** (6 points) Let $f(x) = x^2$.",
      },
      {
        label: "exercise",
        exercise_number: "7.2a",
        points: 2,
        markdown: "a) Compute $f'(x)$. (2 points)",
      },
      {
        label: "exercise",
        exercise_number: "7.2b",
        points: 4,
        markdown: "b) Find the minimum of $f$. (4 points)",
      },
    ]);
    expect(db.tables.materials[0]).toMatchObject({
      parse_status: "parsed",
      is_exam: false,
      exam_year: null,
      exam_total_points: null,
    });
  });

  test("stores an old exam's year and total points on the Material", async () => {
    seedMaterial(db, "application/pdf", await fixture("old-exam.pdf"));
    const { model } = pageModel(
      [
        {
          units: [
            unit({ label: "admin", markdown: "Final exam 2023. 60 points." }),
            unit({
              label: "exercise",
              markdown: "1. Prove that $\\sqrt{2}$ is irrational.",
              exerciseNumber: "1",
              points: 10,
            }),
          ],
        },
      ],
      {
        chunks: [
          chunk(["p1u1"], "admin"),
          chunk(["p1u2"], "exercise", { exerciseNumber: "1", points: 10 }),
        ],
        exam: { isOldExam: true, year: 2023, totalPoints: 60 },
      },
    );
    useMockModels({ ingest: model });

    await parseMaterial(MATERIAL);

    expect(db.tables.materials[0]).toMatchObject({
      parse_status: "parsed",
      is_exam: true,
      exam_year: 2023,
      exam_total_points: 60,
    });
    expect(storedChunks(db)).toHaveLength(2);
  });

  test("replaces the chunks of an earlier parse instead of adding to them", async () => {
    seedMaterial(db, "application/pdf", await fixture("exercise-sheet.pdf"));
    db.tables.chunks.push({
      id: "old-chunk",
      owner: STUDENT,
      course_id: COURSE,
      material_id: MATERIAL,
      position: 0,
      page_from: 1,
      page_to: 1,
      label: "content",
      markdown: "From the earlier parse",
    });
    useMockModels({
      ingest: pageModel([{ units: [unit({ markdown: "New" })] }]).model,
    });

    await parseMaterial(MATERIAL);

    expect(storedChunks(db).map((stored) => stored.markdown)).toEqual(["New"]);
  });

  test("fails the parse when the chunks leave out a unit, keeping the earlier chunks", async () => {
    seedMaterial(db, "application/pdf", await fixture("exercise-sheet.pdf"));
    db.tables.chunks.push({
      id: "old-chunk",
      material_id: MATERIAL,
      position: 0,
      markdown: "From the earlier parse",
    });
    useMockModels({
      ingest: pageModel(
        [{ units: [unit({ markdown: "a" }), unit({ markdown: "b" })] }],
        { chunks: [chunk(["p1u1"], "content")], exam: null },
      ).model,
    });

    await parseMaterial(MATERIAL);

    expect(db.tables.materials[0]).toMatchObject({ parse_status: "failed" });
    expect(storedChunks(db).map((stored) => stored.markdown)).toEqual([
      "From the earlier parse",
    ]);
  });

  test("parses a Material with a blank page, which gets an admin chunk", async () => {
    seedMaterial(db, "application/pdf", await fixture("two-page-lecture.pdf"));
    const { model, filePrompts } = pageModel([
      { units: [unit({ markdown: "Content" })] },
      { units: [] },
    ]);
    useMockModels({ ingest: model });

    await parseMaterial(MATERIAL);

    expect(db.tables.materials[0]).toMatchObject({ parse_status: "parsed" });
    expect(sentUnits(filePrompts[0]).map(({ id, page }) => [id, page])).toEqual(
      [
        ["p1u1", 1],
        ["p2u1", 2],
      ],
    );
    expect(storedChunks(db)).toEqual([
      expect.objectContaining({ page_from: 1, markdown: "Content" }),
      expect.objectContaining({
        page_from: 2,
        page_to: 2,
        label: "admin",
        markdown: "This page has no content.",
      }),
    ]);
  });

  test("parses a Material whose every page is blank", async () => {
    seedMaterial(db, "application/pdf", await fixture("two-page-lecture.pdf"));
    useMockModels({
      ingest: pageModel([{ units: [] }, { units: [] }], {
        chunks: [chunk(["p1u1"], "admin"), chunk(["p2u1"], "admin")],
        exam: null,
      }).model,
    });

    await parseMaterial(MATERIAL);

    expect(db.tables.materials[0]).toMatchObject({ parse_status: "parsed" });
    expect(storedChunks(db).map(({ page_from }) => page_from)).toEqual([1, 2]);
  });

  test("checks the Daily limit before the file call, and a reached limit fails the parse", async () => {
    // The page call's own cost reaches this limit.
    vi.stubEnv("AI_DAILY_LIMIT_USD", "0.0000001");
    seedMaterial(db, "application/pdf", await fixture("exercise-sheet.pdf"));
    const { model, prompts, filePrompts } = pageModel([
      { units: [unit({ markdown: "a" })] },
    ]);
    useMockModels({ ingest: model });

    await parseMaterial(MATERIAL);

    expect(prompts).toHaveLength(1);
    expect(filePrompts).toHaveLength(0);
    expect(db.tables.materials[0]).toMatchObject({
      parse_status: "failed",
      parse_failure: "Daily limit reached",
    });
    expect(db.tables.chunks).toEqual([]);
  });
});
