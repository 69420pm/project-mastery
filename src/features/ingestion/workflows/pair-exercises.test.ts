// @vitest-environment node
import sharp from "sharp";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  COURSE,
  createParseDb,
  deleteMaterialRows,
  pageModel,
  seedMaterial,
  sentPairing,
  storedPairs,
  STUDENT,
  unit,
  type CannedPairing,
  type SentPairing,
} from "@/features/ingestion/workflows/parse-testing";
import { useMockModels } from "@/lib/ai/testing";
import { markAdminClient } from "@/lib/supabase/admin-brand";
import type { Supabase } from "@/lib/supabase/types";

/**
 * Pairing exercises with their solutions across a Course: the parse
 * workflow and the Course's pairing workflow in-process, on the admin
 * client's tables, with a mock `ingest` model.
 */

vi.mock("server-only", () => ({}));

let db = createParseDb();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));

const { parseMaterial } = await import("./parse-material");
const { pairCourse } = await import("./pair-exercises");

const SHEET = "aaaaaaaa-0000-4000-8000-0000000000e1";
const SOLUTIONS = "aaaaaaaa-0000-4000-8000-000000000051";

let pageImage: Uint8Array;

beforeEach(async () => {
  db = createParseDb();
  pageImage ??= new Uint8Array(
    await sharp({
      create: { width: 20, height: 20, channels: 3, background: "white" },
    })
      .png()
      .toBuffer(),
  );
});

/** Uploads a one-page Material, so each parse makes one page call. */
const upload = (id: string, name: string) =>
  seedMaterial(db, "image/png", pageImage, { id, name });

const exercise = (exerciseNumber: string | null, markdown: string) =>
  unit({ label: "exercise", exerciseNumber, markdown });
const solution = (exerciseNumber: string | null, markdown: string) =>
  unit({ label: "solution", exerciseNumber, markdown });

/** Pairs the offered exercise and solution with these markdowns. */
const pairByMarkdown =
  (pairs: Array<[string, string]>) =>
  (sent: SentPairing): CannedPairing => ({
    pairs: pairs.map(([exerciseMarkdown, solutionMarkdown]) => ({
      exerciseId: sent.exercises.find((e) => e.markdown === exerciseMarkdown)!
        .id,
      solutionId: sent.solutions.find((s) => s.markdown === solutionMarkdown)!
        .id,
    })),
  });

describe("pairing exercises with solutions", () => {
  test("pairs exercises with solutions in a separate Material by number", async () => {
    upload(SHEET, "Sheet 7");
    upload(SOLUTIONS, "Solutions 7");
    const { model, pairingPrompts } = pageModel([
      {
        units: [
          exercise("7.2a", "Show that a_n converges."),
          exercise("Aufgabe 7.2 b)", "Find its limit."),
        ],
      },
      {
        units: [
          solution("7.2 b)", "The limit is 0."),
          solution("7.2a", "By monotonicity ..."),
        ],
      },
    ]);
    useMockModels({ ingest: model });

    await parseMaterial(SHEET);
    await parseMaterial(SOLUTIONS);

    expect(storedPairs(db)).toEqual([
      {
        exercise: "Find its limit.",
        solution: "The limit is 0.",
        status: "paired",
      },
      {
        exercise: "Show that a_n converges.",
        solution: "By monotonicity ...",
        status: "paired",
      },
    ]);
    // Every number matched, so no content call was needed.
    expect(pairingPrompts).toHaveLength(0);
  });

  test("a solution sheet parsed later re-pairs the earlier exercises", async () => {
    upload(SHEET, "Sheet 7");
    const { model } = pageModel([
      { units: [exercise("7.1", "Compute the sum.")] },
      { units: [solution("7.1", "The sum is 3.")] },
    ]);
    useMockModels({ ingest: model });

    await parseMaterial(SHEET);
    expect(storedPairs(db)).toEqual([
      { exercise: "Compute the sum.", solution: null, status: "no_solution" },
    ]);

    upload(SOLUTIONS, "Solutions 7");
    await parseMaterial(SOLUTIONS);
    expect(storedPairs(db)).toEqual([
      {
        exercise: "Compute the sum.",
        solution: "The sum is 3.",
        status: "paired",
      },
    ]);
  });

  test("pairs what numbers leave by content, and the rest has no solution", async () => {
    upload(SHEET, "Sheet 7");
    upload(SOLUTIONS, "Solutions 7");
    const { model, pairingPrompts } = pageModel(
      [
        {
          units: [
            exercise("1", "Prove the triangle inequality."),
            exercise(null, "Bonus: compute pi to 3 digits."),
            exercise("2", "Integrate x^2."),
          ],
        },
        {
          units: [
            solution("1", "Square both sides ..."),
            solution(null, "pi is about 3.14."),
          ],
        },
      ],
      undefined,
      pairByMarkdown([["Bonus: compute pi to 3 digits.", "pi is about 3.14."]]),
    );
    useMockModels({ ingest: model });

    await parseMaterial(SHEET);
    const usageBefore = db.tables.ai_usage.length;
    await parseMaterial(SOLUTIONS);

    expect(storedPairs(db)).toEqual([
      {
        exercise: "Bonus: compute pi to 3 digits.",
        solution: "pi is about 3.14.",
        status: "paired",
      },
      { exercise: "Integrate x^2.", solution: null, status: "no_solution" },
      {
        exercise: "Prove the triangle inequality.",
        solution: "Square both sides ...",
        status: "paired",
      },
    ]);
    // One content call, offered only what the numbers left.
    expect(pairingPrompts).toHaveLength(1);
    const offered = sentPairing(pairingPrompts[0]);
    expect(offered.exercises.map((e) => e.markdown)).toEqual([
      "Bonus: compute pi to 3 digits.",
      "Integrate x^2.",
    ]);
    expect(offered.solutions.map((s) => s.markdown)).toEqual([
      "pi is about 3.14.",
    ]);
    // Page call, file call and content call, each recorded for the Student.
    expect(db.tables.ai_usage.slice(usageBefore)).toHaveLength(3);
    expect(db.tables.ai_usage.at(-1)).toMatchObject({
      owner: STUDENT,
      task: "ingest",
    });
  });

  test("with the Daily limit reached, what numbers leave has no solution, without a call", async () => {
    upload(SHEET, "Sheet 7");
    upload(SOLUTIONS, "Solutions 7");
    const { model, pairingPrompts } = pageModel([
      { units: [exercise(null, "Bonus task.")] },
      { units: [solution(null, "Bonus answer.")] },
    ]);
    useMockModels({ ingest: model });
    await parseMaterial(SHEET);
    await parseMaterial(SOLUTIONS);
    expect(pairingPrompts).toHaveLength(1);

    // Spend the Daily limit, then pair again.
    vi.stubEnv("AI_DAILY_LIMIT_USD", "1");
    db.tables.ai_usage.push({
      owner: STUDENT,
      task: "chat",
      cost_usd: 1000,
      created_at: new Date().toISOString(),
    });
    await pairCourse(COURSE);

    expect(pairingPrompts).toHaveLength(1);
    expect(storedPairs(db)).toEqual([
      { exercise: "Bonus task.", solution: null, status: "no_solution" },
    ]);
  });

  test("deleting the solution Material un-pairs its exercises when pairing runs again", async () => {
    upload(SHEET, "Sheet 7");
    upload(SOLUTIONS, "Solutions 7");
    const { model } = pageModel([
      { units: [exercise("3a", "Draw the graph.")] },
      { units: [solution("3", "See the plot.")] },
    ]);
    useMockModels({ ingest: model });
    await parseMaterial(SHEET);
    await parseMaterial(SOLUTIONS);
    expect(storedPairs(db)).toEqual([
      {
        exercise: "Draw the graph.",
        solution: "See the plot.",
        status: "paired",
      },
    ]);

    deleteMaterialRows(db, SOLUTIONS);
    expect(storedPairs(db)).toEqual([]);
    await pairCourse(COURSE);

    expect(storedPairs(db)).toEqual([
      { exercise: "Draw the graph.", solution: null, status: "no_solution" },
    ]);
  });

  test("of two passes that overlap, the later requested one is stored", async () => {
    upload(SHEET, "Sheet 7");
    upload(SOLUTIONS, "Solutions 7");
    let releaseFirst = () => {};
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let pairingCalls = 0;
    const pairs = pairByMarkdown([["Bonus task.", "Bonus answer."]]);
    const { model, pairingPrompts } = pageModel(
      [
        { units: [exercise(null, "Bonus task.")] },
        { units: [solution(null, "Bonus answer.")] },
      ],
      undefined,
      async (sent) => {
        pairingCalls += 1;
        // The first pass is held in its call and pairs; the second does not.
        if (pairingCalls === 1) {
          await firstHeld;
          return pairs(sent);
        }
        return { pairs: [] };
      },
    );
    useMockModels({ ingest: model });
    await parseMaterial(SHEET);
    const solutionsParse = parseMaterial(SOLUTIONS);
    await vi.waitFor(() => expect(pairingPrompts).toHaveLength(1));

    await pairCourse(COURSE);
    releaseFirst();
    await solutionsParse;

    expect(storedPairs(db)).toEqual([
      { exercise: "Bonus task.", solution: null, status: "no_solution" },
    ]);
  });
});
