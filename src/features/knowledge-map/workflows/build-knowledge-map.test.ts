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
  storedTopics,
  useBuildModels,
} from "./build-testing";

/**
 * Update map in-process on the admin client's tables, with mock `map` and
 * `embed` models: KCs from the teaching Parts, consolidated, in Course
 * order, resumed where a build stopped.
 */

vi.mock("server-only", () => ({}));

let db = createBuildDb();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));

const { buildKnowledgeMap } = await import("./build-knowledge-map");

const build = () => db.tables.knowledge_map_builds[0];

async function update() {
  queueBuild(db);
  await buildKnowledgeMap(COURSE);
}

beforeEach(() => {
  db = createBuildDb();
});

describe("Update map", () => {
  test("extracts each teaching Part once and puts its KCs in Course order", async () => {
    // Uploaded second, but first in Course order.
    seedMaterial(db, {
      position: 1,
      language: "de",
      parts: [
        { title: "Sums", chapter: "Chapter 2" },
        { title: "Sheet 1", kind: "exercise" },
      ],
    });
    seedMaterial(db, {
      position: 0,
      language: "de",
      parts: [{ title: "Vectors", chapter: "Chapter 1" }],
    });
    seedMaterial(db, { position: 2, language: "en", parts: [] });
    const { extractions } = useBuildModels();

    await update();

    expect(build()).toMatchObject({ status: "built", failure_reason: null });
    // Exercise Parts make no extraction call.
    expect(extractions.map((part) => [part.title, part.language])).toEqual([
      ["Vectors", "de"],
      ["Sums", "de"],
    ]);
    expect(liveKcs(db)).toEqual([
      ["Vectors", "Chapter 1"],
      ["Sums", "Chapter 2"],
    ]);
    expect(db.tables.kc_sources).toHaveLength(2);
  });

  test("drops a KC that cites a chunk it was not offered, and builds the rest", async () => {
    seedMaterial(db, { parts: [{ title: "Vectors" }] });
    useBuildModels({
      kcsOf: () => ["Vectors", "Ghost"],
      chunkIdOf: (kc, part) => (kc === "Ghost" ? "c99" : part.chunks[0]!.id),
    });

    await update();

    expect(build()?.status).toBe("built");
    expect(liveKcs(db).map(([name]) => name)).toEqual(["Vectors"]);
  });

  test("merges a KC alike to a stored one into the older KC, which gains its sources", async () => {
    seedMaterial(db, { parts: [{ title: "Vectors" }] });
    useBuildModels({ kcsOf: () => ["Vector"] });
    await update();
    const [first] = db.tables.kcs;

    seedMaterial(db, { parts: [{ title: "More vectors" }] });
    const { merges } = useBuildModels({ kcsOf: () => ["Vector"] });
    await update();

    expect(merges).toHaveLength(1);
    expect(db.tables.kcs.map((kc) => kc.id)).toEqual([first!.id]);
    expect(db.tables.kc_sources).toHaveLength(2);
  });

  test("makes no call for Parts it extracted before", async () => {
    seedMaterial(db, { parts: [{ title: "Vectors" }, { title: "Sums" }] });
    useBuildModels();
    await update();

    const { extractions, merges, checks, namings, embedded } = useBuildModels();
    await update();

    expect(build()?.status).toBe("built");
    expect([extractions, merges, checks, namings, embedded]).toEqual([
      [],
      [],
      [],
      [],
      [],
    ]);
    expect(liveKcs(db)).toHaveLength(2);
  });

  test("groups the KCs into Topics from Parts, named once per Big idea, and keeps a Topic while its Parts stay", async () => {
    const kcsOf = (part: { title: string }) =>
      part.title === "Bases"
        ? ["Basis", "Coordinates", "Dimension"]
        : [part.title];
    seedMaterial(db, {
      parts: [
        { title: "Vectors", chapter: "Vector spaces" },
        { title: "Bases", chapter: "Vector spaces" },
        { title: "Maps", chapter: "Linear maps" },
      ],
    });
    const { namings } = useBuildModels({ kcsOf });
    await update();

    expect(namings.map((call) => call.bigIdea)).toEqual([
      "Vector spaces",
      "Linear maps",
    ]);
    expect(storedTopics(db)).toEqual([
      [
        "Topic Vectors, Bases",
        ["Vectors", "Basis", "Coordinates", "Dimension"],
      ],
      ["Topic Maps", ["Maps"]],
    ]);
    expect(db.tables.big_ideas.map((row) => row.name)).toEqual([
      "Vector spaces",
      "Linear maps",
    ]);
    const kept = db.tables.topics[0]!.id;

    seedMaterial(db, { parts: [{ title: "Rank", chapter: "Linear maps" }] });
    const again = useBuildModels({ kcsOf });
    await update();

    expect(again.namings.map((call) => call.topics)).toEqual([
      [{ id: "t1", parts: ["Maps", "Rank"], kcs: ["Maps", "Rank"] }],
    ]);
    expect(db.tables.topics.map((row) => row.id)).toContain(kept);
    expect(db.tables.topics).toHaveLength(2);
    expect(build()?.check_report).toMatchObject({
      kcsPerPart: [
        { part: "Vectors", kcs: 1, budget: 1 },
        { part: "Bases", kcs: 3, budget: 1 },
        { part: "Maps", kcs: 1, budget: 1 },
        { part: "Rank", kcs: 1, budget: 1 },
      ],
      partsWithoutKcs: [],
    });
  });

  test("makes what a KC assumes a Prerequisite on an earlier KC, once", async () => {
    seedMaterial(db, {
      parts: [{ title: "Vectors" }, { title: "Sums" }, { title: "Bases" }],
    });
    const { checks } = useBuildModels({
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
    seedMaterial(db, {
      parts: [{ title: "Vectors" }, { title: "Sums" }, { title: "Bases" }],
    });
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
    expect(db.tables.part_extractions).toHaveLength(1);

    db.tables.ai_usage = [];
    const { extractions } = useBuildModels();
    await update();

    expect(extractions.map((part) => part.title)).toEqual(["Sums", "Bases"]);
    expect(build()?.status).toBe("built");
    expect(liveKcs(db).map(([name]) => name)).toEqual([
      "Vectors",
      "Sums",
      "Bases",
    ]);
  });

  test("retires the KCs of a deleted Material, keeping their Attempts, and revives one taught again", async () => {
    seedMaterial(db, { parts: [{ title: "Vectors" }] });
    const notes = seedMaterial(db, { parts: [{ title: "Sums" }] });
    useBuildModels();
    await update();
    const sums = db.tables.kcs.find((kc) => kc.name === "Sums")!;
    db.tables.attempts.push({ kc_id: sums.id, grade: "full" });

    deleteMaterial(db, notes);
    await update();

    expect(liveKcs(db).map(([name]) => name)).toEqual(["Vectors"]);
    expect(sums.retired_at).toBeTruthy();
    expect(db.tables.attempts).toHaveLength(1);
    expect(storedTopics(db)).toEqual([["Topic Vectors", ["Vectors"]]]);

    seedMaterial(db, { parts: [{ title: "Sums" }] });
    await update();

    expect(sums.retired_at).toBeNull();
    expect(db.tables.kcs).toHaveLength(2);
    expect(liveKcs(db).map(([name]) => name)).toEqual(["Vectors", "Sums"]);
  });

  test("fails with nothing to map when the Course has no Parts", async () => {
    seedMaterial(db, { parts: [] });
    useBuildModels();

    await update();

    expect(build()).toMatchObject({
      status: "failed",
      failure_reason: nothingToMapReason,
    });
  });
});
