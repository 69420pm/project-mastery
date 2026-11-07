// @vitest-environment node
import sharp from "sharp";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  COURSE,
  createParseDb,
  deleteMaterialRows,
  NO_OUTLINE,
  pageModel,
  seedMaterial,
  storedPairs,
  STUDENT,
  unit,
  useMockModels,
  type CannedPairing,
  type SentPairing,
} from "@/features/ingestion/workflows/parse-testing";
import { dailyLimitReason } from "@/features/ingestion/domain/parse-failure";
import { mockEmbeddingModel } from "@/lib/ai/testing";
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

const exercise = (markdown: string) => unit({ label: "exercise", markdown });
const solution = (markdown: string) => unit({ label: "solution", markdown });

/** Pairs the sent exercise and solution whose texts hold these. */
const pairByText =
  (pairs: Array<[string, string]>) =>
  (sent: SentPairing): CannedPairing => ({
    pairs: pairs.map(([exerciseText, solutionText]) => ({
      exerciseId: sent.exercises.find((e) => e.text.includes(exerciseText))!.id,
      solutionId: sent.solutions.find((s) => s.text.includes(solutionText))!.id,
    })),
  });

describe("pairing exercises with solutions", () => {
  test("a solution sheet parsed later pairs the earlier exercises in one call", async () => {
    upload(SHEET, "Sheet 7");
    const statusDuringPairing: unknown[] = [];
    const { model, pairingPrompts } = pageModel(
      [
        {
          units: [
            unit({ label: "heading", markdown: "8.3 Vector spaces" }),
            exercise("Exercise 8. Decide which sets are subspaces."),
            exercise("Exercise 9. Show that sin and cos are independent."),
          ],
        },
        {
          units: [solution(`Solution to Exercise 8. ${"Yes. ".repeat(100)}`)],
        },
      ],
      (sent) => {
        statusDuringPairing.push(
          db.tables.materials.find((m) => m.id === SOLUTIONS)?.parse_status,
        );
        return pairByText([["Exercise 8.", "Solution to Exercise 8"]])(sent);
      },
      (sent) => ({
        ...NO_OUTLINE,
        chapters: sent.headings.map((heading) => ({
          title: heading.text,
          level: 1,
          heading: heading.id,
          page: null,
          exam: false,
        })),
      }),
    );
    useMockModels({ ingest: model });

    await parseMaterial(SHEET);
    // Exercises without any solution in the Course need no call.
    expect(pairingPrompts).toHaveLength(0);
    expect(storedPairs(db).map((pair) => pair.status)).toEqual([
      "no_solution",
      "no_solution",
    ]);

    upload(SOLUTIONS, "Solutions 7");
    await parseMaterial(SOLUTIONS);

    expect(pairingPrompts).toHaveLength(1);
    const [sent] = pairingPrompts;
    expect(sent!.exercises).toEqual([
      {
        id: "e1",
        material: "Sheet 7",
        chapter: "8.3 Vector spaces",
        text: expect.stringContaining("Exercise 8. Decide"),
      },
      expect.objectContaining({ id: "e2", chapter: "8.3 Vector spaces" }),
    ]);
    expect(sent!.solutions).toEqual([
      expect.objectContaining({ id: "s1", material: "Solutions 7" }),
    ]);
    expect(sent!.solutions[0]!.text).toHaveLength(300);

    expect(statusDuringPairing).toEqual(["parsing"]);
    expect(
      db.tables.materials.find((m) => m.id === SOLUTIONS)?.parse_status,
    ).toBe("parsed");
    expect(storedPairs(db)).toEqual([
      {
        exercise: expect.stringContaining("Exercise 8."),
        solution: expect.stringMatching(/^Solution to Exercise 8\./),
        status: "paired",
      },
      {
        exercise: expect.stringContaining("Exercise 9."),
        solution: null,
        status: "no_solution",
      },
    ]);
  });

  test("a large Course goes in calls of at most 400 chunks", async () => {
    upload(SHEET, "Sheet 7");
    const { model, pairingPrompts } = pageModel([
      {
        units: [
          ...Array.from({ length: 399 }, (_, i) => exercise(`Task ${i}.`)),
          solution("Answer A."),
          exercise("Task 399."),
          solution("Answer B."),
        ],
      },
    ]);
    useMockModels({ ingest: model });

    await parseMaterial(SHEET);

    expect(
      pairingPrompts.map((sent) => [
        sent.exercises.length,
        sent.solutions.length,
      ]),
    ).toEqual([
      [399, 1],
      [1, 1],
    ]);
    expect(storedPairs(db)).toHaveLength(400);
  });

  test("a pass starts no call that could run past the step's limit", async () => {
    upload(SHEET, "Sheet 7");
    // Each pairing call takes 200 seconds.
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { model, pairingPrompts } = pageModel(
      [
        {
          units: [
            ...Array.from({ length: 399 }, (_, i) => exercise(`Task ${i}.`)),
            solution("Answer A."),
            exercise("Task 399."),
            solution("Answer B."),
          ],
        },
      ],
      (sent) => (
        (now += 200_000),
        pairByText([["Task 0.", "Answer A."]])(sent)
      ),
    );
    useMockModels({ ingest: model });

    await parseMaterial(SHEET);

    expect(pairingPrompts).toHaveLength(1);
    const pairs = storedPairs(db);
    expect(pairs).toHaveLength(400);
    expect(pairs.filter((pair) => pair.solution !== null)).toEqual([
      { exercise: "Task 0.", solution: "Answer A.", status: "paired" },
    ]);
  });

  test("with the Daily limit reached, the Course's pass stores no solution, without a call", async () => {
    upload(SHEET, "Sheet 7");
    const { model, pairingPrompts } = pageModel(
      [{ units: [exercise("Bonus task."), solution("Bonus answer.")] }],
      pairByText([["Bonus task.", "Bonus answer."]]),
    );
    useMockModels({ ingest: model });
    await parseMaterial(SHEET);
    expect(pairingPrompts).toHaveLength(1);

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

  test("a parse that reaches the Daily limit while pairing fails with that reason", async () => {
    upload(SHEET, "Sheet 7");
    const { model, pairingPrompts } = pageModel([
      { units: [exercise("Bonus task."), solution("Bonus answer.")] },
    ]);
    // The embeds use up the rest of the Daily limit.
    const embed = mockEmbeddingModel();
    const doEmbed = embed.doEmbed;
    embed.doEmbed = async (options) => {
      vi.stubEnv("AI_DAILY_LIMIT_USD", "1");
      db.tables.ai_usage.push({
        owner: STUDENT,
        task: "chat",
        cost_usd: 1000,
        created_at: new Date().toISOString(),
      });
      return doEmbed.call(embed, options);
    };
    useMockModels({ ingest: model, embed });

    await parseMaterial(SHEET);

    expect(db.tables.materials[0]).toMatchObject({
      parse_status: "failed",
      parse_failure: dailyLimitReason,
    });
    expect(pairingPrompts).toHaveLength(0);
  });

  test("deleting the solution Material un-pairs its exercises when pairing runs again", async () => {
    upload(SHEET, "Sheet 7");
    upload(SOLUTIONS, "Solutions 7");
    const { model } = pageModel(
      [
        { units: [exercise("Draw the graph.")] },
        { units: [solution("See the plot.")] },
      ],
      pairByText([["Draw the graph.", "See the plot."]]),
    );
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

  test("a parse whose pass is outdated by one that never writes still ends with every exercise paired", async () => {
    upload(SHEET, "Sheet 7");
    const { model } = pageModel([
      { units: [exercise("Prove it."), exercise("Compute it.")] },
    ]);
    useMockModels({ ingest: model });
    // Right after this parse's first request, another pass is requested
    // (another parse finishing), and that pass fails for good.
    const rpc = db.rpc;
    let interrupted = false;
    db.rpc = async (name, args) => {
      const result = await rpc(name, args);
      if (name === "request_exercise_pairing" && !interrupted) {
        interrupted = true;
        await rpc(name, args);
      }
      return result;
    };

    await parseMaterial(SHEET);

    expect(db.tables.materials[0]).toMatchObject({ parse_status: "parsed" });
    expect(storedPairs(db)).toEqual([
      { exercise: "Compute it.", solution: null, status: "no_solution" },
      { exercise: "Prove it.", solution: null, status: "no_solution" },
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
    const pairs = pairByText([["Bonus task.", "Bonus answer."]]);
    const { model, pairingPrompts } = pageModel(
      [
        { units: [exercise("Bonus task.")] },
        { units: [solution("Bonus answer.")] },
      ],
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
