// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  dailyLimitReason,
  nothingToMapReason,
} from "@/features/knowledge-map/domain/build-failure";
import { markAdminClient } from "@/lib/supabase/admin-brand";
import type { Supabase } from "@/lib/supabase/types";
import {
  COURSE,
  createBuildDb,
  deleteMaterial,
  liveKcs,
  queueBuild,
  seedMaterial,
  STUDENT,
  unitTitle,
  useBuildModels,
} from "./build-testing";

/**
 * Update map in-process on the admin client's tables, with mock `map` and
 * `embed` models: KCs from units of Chapters, consolidated, in Course
 * order, resumed where a build stopped.
 */

vi.mock("server-only", () => ({}));

let db = createBuildDb();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));

const { buildKnowledgeMap } = await import("./build-knowledge-map");

const build = () => db.tables.knowledge_map_builds[0];

/** Text that fills more than half of a unit's 120,000 characters. */
const halfAUnit = "word ".repeat(13_000);

async function update() {
  queueBuild(db);
  await buildKnowledgeMap(COURSE);
}

beforeEach(() => {
  db = createBuildDb();
});

describe("Update map", () => {
  test("extracts each Material under the cap as one unit, with its Outline, and puts the KCs in Course order", async () => {
    // Uploaded second, but first in Course order.
    seedMaterial(db, {
      position: 1,
      language: "German",
      chapters: [{ title: "Sums" }, { title: "Sheet 1", exercise: true }],
    });
    seedMaterial(db, {
      position: 0,
      language: "German",
      chapters: [{ title: "Vectors", children: [{ title: "Bases" }] }],
    });
    seedMaterial(db, { position: 2, language: "English", chapters: [] });
    const { extractions, reasoning } = useBuildModels({
      kcsOf: (unit) => unit.chunks.map((chunk) => chunk.markdown),
      chunkIdOf: (kc, unit) =>
        unit.chunks.find((chunk) => chunk.markdown === kc)!.id,
    });

    await update();

    expect(build()).toMatchObject({ status: "built", failure_reason: null });
    // Exercise chunks make no extraction call.
    expect(extractions).toEqual([
      {
        material: "Material 0",
        outline: ["Material 0  <- this unit", "  Vectors", "    Bases"],
        language: "German",
        chunks: [
          { id: "c1", markdown: "About Vectors." },
          { id: "c2", markdown: "About Bases." },
        ],
      },
      expect.objectContaining({
        chunks: [{ id: "c1", markdown: "About Sums." }],
      }),
    ]);
    expect(reasoning.every((setting) => setting === "high")).toBe(true);
    expect(liveKcs(db)).toEqual([
      "About Vectors.",
      "About Bases.",
      "About Sums.",
    ]);
    expect(db.tables.kcs.every((kc) => kc.big_idea_id === null)).toBe(true);
    expect(db.tables.kc_sources).toHaveLength(3);
  });

  test("splits a Chapter over the cap into its children and its own chunks", async () => {
    seedMaterial(db, {
      chapters: [
        {
          title: "Vector spaces",
          chunks: ["Opening."],
          children: [
            { title: "Subspaces", chunks: [halfAUnit] },
            { title: "Bases", chunks: [`${halfAUnit}.`] },
          ],
        },
      ],
    });
    const { extractions } = useBuildModels();

    await update();

    expect(extractions.map(unitTitle)).toEqual([
      "Vector spaces",
      "Subspaces",
      "Bases",
    ]);
    expect(liveKcs(db)).toEqual(["Vector spaces", "Subspaces", "Bases"]);
    expect(
      db.tables.chapter_extractions.map((row) => [row.kind, row.unit]),
    ).toEqual([
      ["content", 0],
      ["content", 0],
      ["content", 0],
    ]);
  });

  test("asks once more when a call answers nothing", async () => {
    seedMaterial(db, { chapters: [{ title: "Vectors" }] });
    const { extractions } = useBuildModels({ blankCalls: 1 });

    await update();

    expect(extractions).toHaveLength(1);
    expect(build()?.status).toBe("built");
    expect(liveKcs(db)).toEqual(["Material 0"]);
  });

  test("drops a KC that cites a chunk it was not offered, and builds the rest", async () => {
    seedMaterial(db, { chapters: [{ title: "Vectors" }] });
    useBuildModels({
      kcsOf: () => ["Vectors", "Ghost"],
      chunkIdOf: (kc, unit) => (kc === "Ghost" ? "c99" : unit.chunks[0]!.id),
    });

    await update();

    expect(build()?.status).toBe("built");
    expect(liveKcs(db)).toEqual(["Vectors"]);
  });

  test("merges a KC alike to a stored one into the older KC, which gains its sources", async () => {
    seedMaterial(db, { chapters: [{ title: "Vectors" }] });
    useBuildModels({ kcsOf: () => ["Vector"] });
    await update();
    const [first] = db.tables.kcs;

    seedMaterial(db, { chapters: [{ title: "More vectors" }] });
    const { merges } = useBuildModels({ kcsOf: () => ["Vector"] });
    await update();

    expect(merges).toHaveLength(1);
    expect(db.tables.kcs.map((kc) => kc.id)).toEqual([first!.id]);
    expect(db.tables.kc_sources).toHaveLength(2);
  });

  test("makes no call for units it extracted before", async () => {
    seedMaterial(db, { chapters: [{ title: "Vectors" }] });
    seedMaterial(db, { chapters: [{ title: "Sums" }] });
    useBuildModels();
    await update();

    const { extractions, merges, checks, embedded } = useBuildModels();
    await update();

    expect(build()?.status).toBe("built");
    expect([extractions, merges, checks, embedded]).toEqual([[], [], [], []]);
    expect(liveKcs(db)).toHaveLength(2);
  });

  test("makes what a KC assumes a Prerequisite on an earlier KC, once", async () => {
    for (const title of ["Vectors", "Sums", "Bases"]) {
      seedMaterial(db, { chapters: [{ title }] });
    }
    const kcOf = (unit: { material: string }) =>
      ({ "Material 0": "Vectors", "Material 1": "Sums" })[unit.material] ??
      "Bases";
    const { checks } = useBuildModels({
      kcsOf: (unit) => [kcOf(unit)],
      assumesOf: (kc) => (kc === "Bases" ? ["Vectors", "Sums"] : []),
      meaningOf: (name) => (name.name === "Vectors" ? "Vectors" : null),
    });
    await update();

    expect(checks).toHaveLength(1);
    expect(checks[0]!.map((name) => name.candidates.length)).toEqual([2, 2]);
    const kcId = (name: string) =>
      db.tables.kcs.find((kc) => kc.name === name)!.id;
    expect(db.tables.prerequisite_links).toMatchObject([
      { from_kc: kcId("Vectors"), to_kc: kcId("Bases") },
    ]);

    const again = useBuildModels();
    await update();
    expect(again.checks).toEqual([]);
  });

  test("resumes a build the Daily limit stopped without repeating stored extractions", async () => {
    vi.stubEnv("AI_DAILY_LIMIT_USD", "1");
    for (const title of ["Vectors", "Sums", "Bases"]) {
      seedMaterial(db, { chapters: [{ title }] });
    }
    const spend = {
      owner: STUDENT,
      task: "chat",
      cost_usd: 5,
      created_at: new Date().toISOString(),
    };
    useBuildModels({
      afterCall: (count) => {
        if (count === 1) db.tables.ai_usage.push(spend);
      },
    });

    await update();

    expect(build()).toMatchObject({
      status: "failed",
      failure_reason: dailyLimitReason,
    });
    expect(db.tables.chapter_extractions).toHaveLength(1);

    db.tables.ai_usage = [];
    const { extractions } = useBuildModels();
    await update();

    expect(extractions.map((unit) => unit.material)).toEqual([
      "Material 1",
      "Material 2",
    ]);
    expect(build()?.status).toBe("built");
    expect(liveKcs(db)).toEqual(["Material 0", "Material 1", "Material 2"]);
  });

  test("retires the KCs of a deleted Material, keeping their Attempts, and revives one taught again", async () => {
    seedMaterial(db, { chapters: [{ title: "Vectors" }] });
    const notes = seedMaterial(db, { chapters: [{ title: "Sums" }] });
    useBuildModels({ kcsOf: (unit) => [unit.chunks[0]!.markdown] });
    await update();
    const sums = db.tables.kcs.find((kc) => kc.name === "About Sums.")!;
    db.tables.attempts.push({ kc_id: sums.id, grade: "full" });

    deleteMaterial(db, notes);
    await update();

    expect(liveKcs(db)).toEqual(["About Vectors."]);
    expect(sums.retired_at).toBeTruthy();
    expect(db.tables.attempts).toHaveLength(1);

    seedMaterial(db, { chapters: [{ title: "Sums" }] });
    await update();

    expect(sums.retired_at).toBeNull();
    expect(db.tables.kcs).toHaveLength(2);
    expect(liveKcs(db)).toEqual(["About Vectors.", "About Sums."]);
  });

  test("reports Chapters no KC cites", async () => {
    seedMaterial(db, { chapters: [{ title: "Vectors" }, { title: "Sums" }] });
    useBuildModels();

    await update();

    expect(build()?.check_report).toMatchObject({
      chaptersWithoutKcs: ["Sums"],
      exercisesWithoutKcs: [],
    });
  });

  test("fails with nothing to map when the Course has no chunks", async () => {
    seedMaterial(db, { chapters: [] });
    useBuildModels();

    await update();

    expect(build()).toMatchObject({
      status: "failed",
      failure_reason: nothingToMapReason,
    });
  });
});
