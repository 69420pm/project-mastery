// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  dailyLimitReason,
  nothingToMapReason,
} from "@/features/knowledge-map/domain/build-failure";
import { UNIT_CHARS } from "@/features/knowledge-map/domain/chapter-units";
import { markAdminClient } from "@/lib/supabase/admin-brand";
import type { Supabase } from "@/lib/supabase/types";
import {
  COURSE,
  createBuildDb,
  deleteMaterial,
  flatTree,
  liveKcs,
  type SentCourse,
  topicTree,
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

const kcId = (name: string) => db.tables.kcs.find((kc) => kc.name === name)!.id;

/** The names the KC of this name assumes as text. */
const assumedBy = (name: string) =>
  (
    db.tables.kcs.find((kc) => kc.name === name)!.assumes as Array<{
      name: string;
    }>
  ).map((entry) => entry.name);

/** One KC per chunk, named by its Markdown and citing it. */
const kcPerChunk = {
  kcsOf: (unit: { chunks: Array<{ markdown: string }> }) =>
    unit.chunks.map((chunk) => chunk.markdown),
  chunkIdOf: (
    kc: string,
    unit: { chunks: Array<{ id: string; markdown: string }> },
  ) => unit.chunks.find((chunk) => chunk.markdown === kc)!.id,
};

/** Text that fills more than half of a unit. */
const halfAUnit = "word ".repeat(UNIT_CHARS / 10 + 1);

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
    expect(reasoning.every((setting) => setting === "medium")).toBe(true);
    expect(liveKcs(db)).toEqual([
      "About Vectors.",
      "About Bases.",
      "About Sums.",
    ]);
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

  describe("a unit whose KCs cite less than half of it", () => {
    /** "Short" cites the unit's short chunk, any other KC its long one. */
    const useAnswers = (
      answers: string[][],
      afterCall?: (n: number) => void,
    ) => {
      seedMaterial(db, {
        chapters: [{ title: "Vectors", chunks: ["Short.", halfAUnit] }],
      });
      return useBuildModels({
        kcsOf: () => (answers.length > 1 ? answers.shift()! : answers[0]!),
        chunkIdOf: (kc, unit) => unit.chunks[kc === "Short" ? 0 : 1]!.id,
        afterCall,
      }).extractions;
    };

    test("is asked once more, and the answer that covers more is kept", async () => {
      const extractions = useAnswers([["Short"], ["Long"]]);
      await update();
      expect(extractions).toHaveLength(2);
      expect(liveKcs(db)).toEqual(["Long"]);
      expect(build()?.check_report).toMatchObject({ unitsBelowCoverage: [] });
    });

    test("is stored still below the bar, and reported", async () => {
      const extractions = useAnswers([["Short"]]);
      await update();
      expect(extractions).toHaveLength(2);
      expect(build()?.status).toBe("built");
      expect(liveKcs(db)).toEqual(["Short"]);
      expect(build()?.check_report).toMatchObject({
        unitsBelowCoverage: [
          { chapter: "Material 0", coverage: expect.any(Number) },
        ],
      });
    });

    test("keeps its first answer when the Daily limit stops the retry", async () => {
      vi.stubEnv("AI_DAILY_LIMIT_USD", "1");
      const created_at = new Date().toISOString();
      const spend = { owner: STUDENT, task: "chat", cost_usd: 5, created_at };
      const atFirst = (n: number) => n === 1 && db.tables.ai_usage.push(spend);
      const extractions = useAnswers([["Short"]], (n) => void atFirst(n));
      await update();
      // The limit stops the build once the first answer is stored.
      expect(extractions).toHaveLength(1);
      expect(db.tables.chapter_extractions).toHaveLength(1);
      expect(build()?.failure_reason).toBe(dailyLimitReason);
    });
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

  test("links what a KC assumes to an earlier KC, not to a later one, and keeps what no KC means as text on the KC, once", async () => {
    for (const title of ["Vectors", "Bases", "Sums"]) {
      seedMaterial(db, { chapters: [{ title }] });
    }
    // The check picks the KC of the name's own name, or null without one.
    const { checks } = useBuildModels({
      kcsOf: (unit) => [unit.chunks[0]!.markdown.slice("About ".length, -1)],
      assumesOf: (kc) => (kc === "Bases" ? ["Vectors", "Sums", "Limits"] : []),
    });
    await update();

    expect(checks).toHaveLength(1);
    expect(
      checks[0]!.map((name) => [name.name, name.candidates.length]),
    ).toEqual([
      ["Vectors", 2],
      ["Sums", 2],
      ["Limits", 2],
    ]);
    expect(
      db.tables.prerequisite_links.map((link) => [link.from_kc, link.to_kc]),
    ).toEqual([[kcId("Vectors"), kcId("Bases")]]);
    expect(assumedBy("Bases")).toEqual(["Limits"]);
    expect(liveKcs(db)).toEqual(["Vectors", "Bases", "Sums"]);
    expect(topicTree(db)).toEqual([
      "Vectors: Vectors",
      "Bases: Bases",
      "Sums: Sums",
    ]);

    const again = useBuildModels();
    await update();
    expect([again.checks, again.trees]).toEqual([[], []]);
    expect(assumedBy("Bases")).toEqual(["Limits"]);
  });

  test("keeps a name that has no candidates as text, once, without a call", async () => {
    seedMaterial(db, { chapters: [{ title: "Vectors" }] });
    const { checks } = useBuildModels({
      assumesOf: () => ["Fields", " fields"],
    });
    await update();

    expect(checks).toEqual([]);
    expect(liveKcs(db)).toEqual(["Material 0"]);
    expect(assumedBy("Material 0")).toEqual(["Fields"]);
    expect(db.tables.prerequisite_links).toEqual([]);
  });

  test("matches text again once a build stores a KC near it", async () => {
    const titleKc = (unit: { chunks: Array<{ markdown: string }> }) => [
      unit.chunks[0]!.markdown.slice("About ".length, -1),
    ];
    seedMaterial(db, { position: 1, chapters: [{ title: "Bases" }] });
    useBuildModels({
      kcsOf: titleKc,
      assumesOf: (kc) => (kc === "Bases" ? ["Vectors", "Limits"] : []),
    });
    await update();
    expect(assumedBy("Bases")).toEqual(["Vectors", "Limits"]);

    // A Material earlier in Course order teaches Vectors.
    seedMaterial(db, { position: 0, chapters: [{ title: "Vectors" }] });
    const { checks } = useBuildModels({ kcsOf: titleKc });
    await update();

    expect(checks.map((names) => names.map((name) => name.name))).toEqual([
      ["Limits", "Vectors"],
    ]);
    expect(
      db.tables.prerequisite_links.map((link) => [link.from_kc, link.to_kc]),
    ).toEqual([[kcId("Vectors"), kcId("Bases")]]);
    expect(assumedBy("Bases")).toEqual(["Limits"]);

    // Without new KCs, the text is not asked about again.
    const again = useBuildModels({ kcsOf: titleKc });
    await update();
    expect(again.checks).toEqual([]);
    expect(assumedBy("Bases")).toEqual(["Limits"]);
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

  test("forms no teaching unit from an old exam, and drops what an earlier build took from it", async () => {
    seedMaterial(db, {
      chapters: [
        { title: "Vectors" },
        { title: "Final exam", children: [{ title: "Task 1" }] },
      ],
    });
    const { extractions } = useBuildModels({
      kcsOf: (unit) => unit.chunks.map((chunk) => chunk.markdown),
      chunkIdOf: (kc, unit) =>
        unit.chunks.find((chunk) => chunk.markdown === kc)!.id,
    });
    await update();
    expect(liveKcs(db)).toEqual([
      "About Vectors.",
      "About Final exam.",
      "About Task 1.",
    ]);

    // The Student confirms the exam; its subtree no longer teaches.
    db.tables.chapters.find((c) => c.title === "Final exam")!.is_exam = true;
    extractions.length = 0;
    await update();

    expect(liveKcs(db)).toEqual(["About Vectors."]);
    expect(db.tables.chapter_extractions).toHaveLength(1);
    expect(build()?.check_report).toMatchObject({ chaptersWithoutKcs: [] });
  });

  test("makes the Topic tree call once, then keeps the tree and its ids without a call", async () => {
    seedMaterial(db, {
      language: "German",
      chapters: [
        {
          title: "Vector spaces",
          children: [{ title: "Subspaces" }, { title: "Bases" }],
        },
      ],
    });
    // Vector spaces holds its opening's KC beside its sections' Topics.
    const nested = (course: SentCourse) =>
      flatTree(course).map((topic, index) => ({
        ...topic,
        level: index === 0 ? 1 : 2,
      }));
    const { trees, reasoning } = useBuildModels({
      ...kcPerChunk,
      treeOf: nested,
    });

    await update();

    expect(trees).toHaveLength(1);
    expect(trees[0]).toMatchObject({ language: "German", storedTopics: [] });
    expect(trees[0]!.materials[0]!.outline).toEqual([
      { id: "c1", title: "Material 0", depth: 0 },
      {
        id: "c2",
        title: "Vector spaces",
        depth: 1,
        kcs: ["About Vector spaces."],
      },
      { id: "c3", title: "Subspaces", depth: 2, kcs: ["About Subspaces."] },
      { id: "c4", title: "Bases", depth: 2, kcs: ["About Bases."] },
    ]);
    expect(reasoning.every((setting) => setting === "medium")).toBe(true);
    expect(topicTree(db)).toEqual([
      "Vector spaces: About Vector spaces.",
      "Subspaces > Vector spaces: About Subspaces.",
      "Bases > Vector spaces: About Bases.",
    ]);
    const ids = db.tables.topics.map((topic) => topic.id);

    const again = useBuildModels(kcPerChunk);
    await update();

    expect(again.trees).toEqual([]);
    expect(db.tables.topics.map((topic) => topic.id)).toEqual(ids);
    expect(topicTree(db)).toHaveLength(3);
  });

  test("calls again when a Chapter's KCs change, and keeps the Topics it continues", async () => {
    seedMaterial(db, { chapters: [{ title: "Vectors" }] });
    useBuildModels(kcPerChunk);
    await update();
    const [vectors] = db.tables.topics;

    seedMaterial(db, { chapters: [{ title: "Sums" }] });
    const { trees } = useBuildModels(kcPerChunk);
    await update();

    expect(trees).toHaveLength(1);
    expect(trees[0]!.storedTopics).toEqual([
      { id: "t1", name: "Vectors", level: 1, chapters: ["c2"] },
    ]);
    expect(topicTree(db)).toEqual([
      "Vectors: About Vectors.",
      "Sums: About Sums.",
    ]);
    expect(db.tables.topics[0]!.id).toBe(vectors!.id);
  });

  test("gives a Chapter the call leaves out a top-level Topic of its own", async () => {
    seedMaterial(db, { chapters: [{ title: "Vectors" }, { title: "Sums" }] });
    useBuildModels({
      ...kcPerChunk,
      treeOf: (course) => flatTree(course).slice(0, 1),
    });

    await update();

    expect(topicTree(db)).toEqual([
      "Vectors: About Vectors.",
      "Sums: About Sums.",
    ]);
    expect(db.tables.topics[1]).toMatchObject({
      central_question: "Sums",
      parent_id: null,
    });
  });

  test("gives each Chapter a Topic of its own when the tree call fails twice, and calls again on the next update", async () => {
    seedMaterial(db, { chapters: [{ title: "Vectors" }, { title: "Sums" }] });
    const { trees } = useBuildModels({
      ...kcPerChunk,
      treeOf: () => undefined,
    });

    await update();

    expect(trees).toHaveLength(2);
    expect(build()?.status).toBe("built");
    expect(topicTree(db)).toEqual([
      "Vectors: About Vectors.",
      "Sums: About Sums.",
    ]);

    const again = useBuildModels(kcPerChunk);
    await update();

    expect(again.trees).toHaveLength(1);
  });

  test("reports the pages read without units", async () => {
    const id = seedMaterial(db, { chapters: [{ title: "Vectors" }] });
    db.tables.material_pages.push(
      { material_id: id, page_number: 4, skipped: "uncovered" },
      { material_id: id, page_number: 2, skipped: "unreadable" },
      { material_id: id, page_number: 3, skipped: "blank" },
    );
    useBuildModels();

    await update();

    expect(build()?.check_report).toMatchObject({
      unreadPages: [{ material: "Material 0", pages: [2, 4] }],
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
