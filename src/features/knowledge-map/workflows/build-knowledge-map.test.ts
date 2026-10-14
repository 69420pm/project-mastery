// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useMockModels } from "@/lib/ai/testing";
import { markAdminClient } from "@/lib/supabase/admin-brand";
import type { FakeRow } from "@/lib/supabase/testing";
import type { Supabase } from "@/lib/supabase/types";
import {
  createMapDb,
  mapModel,
  seedBuild as seedCourseBuild,
  seedMaterial as seedCourseMaterial,
  STUDENT,
  type Sent,
} from "./build-testing";

vi.mock("server-only", () => ({}));

const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";

const createDb = () => createMapDb(COURSE);
let db = createDb();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));

const { buildKnowledgeMap } = await import("./build-knowledge-map");

const seedMaterial = (
  name: string,
  parseStatus: string,
  chunks: Parameters<typeof seedCourseMaterial>[4],
) => seedCourseMaterial(db, COURSE, name, parseStatus, chunks);
const seedBuild = () => seedCourseBuild(db, COURSE);

beforeEach(() => {
  db = createDb();
});

describe("building a Knowledge map", () => {
  test("drafts big ideas, assigns chunks in batches and fills each KC", async () => {
    seedBuild();
    // Eleven teaching chunks make two batches; the exercise is not sent.
    const chunks = seedMaterial("Lecture 1", "parsed", [
      ["definition", "# Compressors\n**Pressure ratio** is p2/p1."],
      ["content", "The turbine drives the compressor."],
      ...Array.from({ length: 8 }, (_, i): [string, string] => [
        "content",
        `Filler ${i}`,
      ]),
      ["exercise", "Exercise 1: compute the pressure ratio."],
      ["content", "Turbine work equals compressor work."],
    ]);
    seedMaterial("Lecture 2", "queued", [["content", "Not parsed yet"]]);
    const { models, sent } = mapModel({
      skeleton: {
        bigIdeas: [
          {
            name: "Compression",
            description: "How air is compressed.",
            kcs: [
              { name: "Pressure ratio", description: "p2/p1." },
              { name: "Unused candidate", description: "No chunk teaches it." },
            ],
          },
          { name: "Empty idea", description: "Nothing here.", kcs: [] },
        ],
      },
      assign: (call) =>
        call === 0
          ? {
              taught: { c1: ["k1"] },
              newKcs: [
                {
                  name: "Turbine work",
                  description: "Drives it.",
                  bigIdea: "b1",
                  chunkIds: ["c2"],
                },
              ],
            }
          : { taught: { c1: ["k3"] }, newKcs: [] },
      links: {
        // A cycle, whose weaker edge goes.
        prerequisites: [
          { from: "k1", to: "k2", extractionConfidence: 0.8 },
          { from: "k2", to: "k1", extractionConfidence: 0.2 },
        ],
        semanticLinks: [
          { from: "k2", to: "k1", coreType: "causes", label: "raises" },
        ],
        priorKcs: [
          {
            name: "Ideal gas law",
            description: "pv = RT.",
            requiredBy: ["k1"],
            extractionConfidence: 0.9,
          },
        ],
      },
    });
    useMockModels(models);

    await buildKnowledgeMap(COURSE);

    expect(db.tables.knowledge_map_builds[0]).toMatchObject({
      status: "built",
    });
    expect(db.tables.big_ideas.map((row) => row.name)).toEqual(["Compression"]);
    expect(
      db.tables.kcs.map(({ name, type, bloom, description }) => ({
        name,
        type,
        bloom,
        description,
      })),
    ).toEqual([
      {
        name: "Pressure ratio",
        type: "concept",
        bloom: "apply",
        description: "Sharp Pressure ratio",
      },
      {
        name: "Turbine work",
        type: "concept",
        bloom: "apply",
        description: "Sharp Turbine work",
      },
      {
        name: "Ideal gas law",
        type: "prior",
        bloom: null,
        description: "pv = RT.",
      },
    ]);
    expect(db.tables.kc_sources.map((row) => row.chunk_id)).toEqual([
      chunks[0],
      chunks[1],
      chunks[11],
    ]);
    const nameOf = (id: unknown) =>
      db.tables.kcs.find((row) => row.id === id)?.name;
    const links = (table: FakeRow[]) =>
      table.map((row) => `${nameOf(row.from_kc)} → ${nameOf(row.to_kc)}`);
    expect(links(db.tables.prerequisite_links)).toEqual([
      "Pressure ratio → Turbine work",
      "Ideal gas law → Pressure ratio",
    ]);
    expect(links(db.tables.semantic_links)).toEqual([
      "Turbine work → Pressure ratio",
    ]);
    expect(db.tables.knowledge_map_builds[0]?.check_report).toEqual({
      // The eight fillers teach nothing.
      uncoveredChunkIds: chunks.slice(2, 10),
      ungroundedKcs: [],
      orphanKcs: [],
      droppedCycleEdges: [
        {
          from: "Turbine work",
          to: "Pressure ratio",
          extractionConfidence: 0.2,
        },
      ],
      // The exercise, unpaired, is answered with no KC.
      unmappedExercises: ["Exercise on Lecture 1 p. 11"],
      untestedKcs: ["Pressure ratio", "Turbine work"],
      duplicates: [],
    });

    const [skeleton, first, second, fill, linksCall] = sent;
    expect(skeleton).toEqual({
      existingBigIdeas: [],
      materials: ["Lecture 1"],
      headings: ["Compressors"],
      definitions: ["# Compressors\n**Pressure ratio** is p2/p1."],
    });
    expect(first?.chunks).toHaveLength(10);
    // The second batch sees the KC the first one proposed.
    expect(second?.kcs?.map((kc) => kc.name)).toContain("Turbine work");
    expect(second?.chunks?.map((chunk) => chunk.markdown)).toEqual([
      "Turbine work equals compressor work.",
    ]);
    expect(fill?.kcs?.map((kc) => kc.name)).toEqual([
      "Pressure ratio",
      "Turbine work",
    ]);
    // KCs go to the links call by their place in the map.
    expect(linksCall?.kcs?.map((kc) => kc.id)).toEqual(["k1", "k2"]);
    expect(sent).toHaveLength(6);
    expect(db.tables.ai_usage.map((row) => row.task)).toEqual([
      ...Array(5).fill("map"),
      "exercise",
      "embed",
    ]);
  });

  test("maps each exercise subtask to KCs and checks or generates its solution", async () => {
    seedBuild();
    const [, q1, s1, q2, s2, q3] = seedMaterial("Chapter 7", "parsed", [
      ["content", "Thermal efficiency is 1 - rp^-0.2857."],
      ["exercise", "Compute the efficiency for rp = 12.", "7.1"],
      ["solution", "46.5%", "7.1"],
      ["exercise", "Compute the thrust.", "7.2a"],
      ["solution", "20 kN", "7.2a"],
      ["exercise", "Compute the propulsive power.", "7.2b"],
    ]);
    db.tables.exercise_solutions.push(
      { course_id: COURSE, exercise_chunk_id: q1, solution_chunk_id: s1 },
      { course_id: COURSE, exercise_chunk_id: q2, solution_chunk_id: s2 },
      { course_id: COURSE, exercise_chunk_id: q3, solution_chunk_id: null },
    );
    const proposedKc = (name: string) => ({
      name,
      description: `${name}.`,
      type: "procedure",
      bloom: "apply",
      bigIdea: "b1",
    });
    const answers: Record<string, object> = {
      "Compute the efficiency for rp = 12.": {
        kcIds: ["k1", "unknown"],
        newKcs: [proposedKc("Propulsive power")],
        taskType: "compute thermal efficiency",
        finalResult: "50.8%",
        givenFinalResult: "46.5%",
        matchesGiven: false,
      },
      "Compute the thrust.": {
        kcIds: ["k1"],
        // Proposed by one subtask only, so not added.
        newKcs: [proposedKc("Bypass ratio")],
        taskType: "compute thrust",
        finalResult: "20 kN",
        givenFinalResult: "20 kN",
        matchesGiven: true,
      },
      "Compute the propulsive power.": {
        kcIds: ["k1"],
        newKcs: [proposedKc("propulsive power")],
        taskType: "compute thrust",
        finalResult: "4 MW",
        steps: 5,
      },
    };
    const { models, sent } = mapModel({
      skeleton: {
        bigIdeas: [
          {
            name: "Efficiency",
            description: "Of the cycle.",
            kcs: [{ name: "Thermal efficiency", description: "η." }],
          },
        ],
      },
      assign: () => ({ taught: { c1: ["k1"] }, newKcs: [] }),
      links: (input: Sent) =>
        input.newKcIds
          ? {
              prerequisites: [
                { from: "k1", to: "k2", extractionConfidence: 0.9 },
              ],
              semanticLinks: [],
              priorKcs: [],
            }
          : undefined,
      exercise: (input) => ({
        newKcs: [],
        solution: "Worked solution.",
        steps: 2,
        ...answers[input.exercise as string],
      }),
    });
    useMockModels(models);

    await buildKnowledgeMap(COURSE);

    expect(db.tables.knowledge_map_builds[0]).toMatchObject({
      status: "built",
    });
    expect(db.tables.exercises).toMatchObject([
      {
        name: "Ex. 7.1",
        question_chunk_id: q1,
        task_type: "compute thermal efficiency",
        solution_status: "disputed",
        solution: null,
        difficulty: 1,
      },
      { name: "Ex. 7.2a", solution_status: "verified", solution: null },
      {
        name: "Ex. 7.2b",
        solution_status: "generated",
        solution: "Worked solution.",
        difficulty: 3,
      },
    ]);
    // The KC two subtasks propose joins from their exercises, with a link
    // from the extra links call; the unknown KC id is dropped.
    expect(
      db.tables.kcs.map(({ name, origin }) => `${name} (${origin})`),
    ).toEqual(["Thermal efficiency (content)", "Propulsive power (exercise)"]);
    const propulsive = db.tables.kcs[1]?.id;
    expect(
      db.tables.kc_sources
        .filter((row) => row.kc_id === propulsive)
        .map((row) => row.chunk_id),
    ).toEqual([q1, q3]);
    expect(db.tables.prerequisite_links).toMatchObject([
      { from_kc: db.tables.kcs[0]?.id, to_kc: propulsive },
    ]);
    expect(
      db.tables.exercise_kcs.filter((row) => row.kc_id === propulsive),
    ).toHaveLength(2);
    expect(db.tables.exercise_kcs).toHaveLength(5);
    const addedLinksCall = sent.find((input) => "newKcIds" in input);
    expect(addedLinksCall?.kcs?.map((kc) => kc.name)).toEqual([
      "Thermal efficiency",
      "Propulsive power",
    ]);
    expect(db.tables.findings.map((row) => row.text)).toEqual([
      "Ex. 7.1: the given answer is 46.5%, our calculation gives 50.8%.",
    ]);
    expect(db.tables.finding_sources.map((row) => row.chunk_id)).toEqual([
      q1,
      s1,
    ]);
    const exerciseCalls = sent.filter((input) => "exercise" in input);
    expect(exerciseCalls.map((input) => input.solution)).toEqual([
      "46.5%",
      "20 kN",
      null,
    ]);
    // Task types seen earlier go into later calls.
    expect(exerciseCalls[2]?.taskTypes).toEqual([
      "compute thermal efficiency",
      "compute thrust",
    ]);
    expect(db.tables.knowledge_map_builds[0]?.check_report).toMatchObject({
      unmappedExercises: [],
      untestedKcs: [],
    });
  });
});

describe("a failed build", () => {
  const oldMap = () =>
    db.tables.big_ideas.push({ id: "old", name: "Old idea" });

  test("stops at the Daily limit with that reason and keeps the previous map", async () => {
    vi.stubEnv("AI_DAILY_LIMIT_USD", "1");
    db.tables.ai_usage.push({
      owner: STUDENT,
      task: "chat",
      cost_usd: 5,
      created_at: new Date().toISOString(),
    });
    seedBuild();
    oldMap();
    seedMaterial("Lecture 1", "parsed", [["content", "Something"]]);
    const { models, sent } = mapModel({
      skeleton: { bigIdeas: [] },
      assign: () => ({ taught: {}, newKcs: [] }),
    });
    useMockModels(models);

    await buildKnowledgeMap(COURSE);

    expect(sent).toHaveLength(0);
    expect(db.tables.knowledge_map_builds[0]).toMatchObject({
      status: "failed",
      failure_reason: "Daily limit reached",
    });
    expect(db.tables.big_ideas.map((row) => row.name)).toEqual(["Old idea"]);
  });

  test("fails with a general reason when a call's answer does not fit", async () => {
    seedBuild();
    oldMap();
    seedMaterial("Lecture 1", "parsed", [["content", "Something"]]);
    const { models } = mapModel({
      skeleton: { wrong: true },
      assign: () => ({ taught: {}, newKcs: [] }),
    });
    useMockModels(models);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await buildKnowledgeMap(COURSE);

    expect(db.tables.knowledge_map_builds[0]).toMatchObject({
      status: "failed",
      failure_reason: "The knowledge map could not be built. Please try again.",
    });
    expect(db.tables.big_ideas.map((row) => row.name)).toEqual(["Old idea"]);
  });
});
