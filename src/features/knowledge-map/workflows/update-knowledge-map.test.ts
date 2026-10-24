// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import { useMockModels } from "@/lib/ai/testing";
import { markAdminClient } from "@/lib/supabase/admin-brand";
import type { Supabase } from "@/lib/supabase/types";
import {
  createMapDb,
  mapModel,
  seedBuild,
  seedMaterial,
} from "./build-testing";

vi.mock("server-only", () => ({}));

const COURSE = "aaaaaaaa-c000-4000-8000-000000000002";

const db = createMapDb(COURSE);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));

const { buildKnowledgeMap } = await import("./build-knowledge-map");

/** Runs one update to its end, which must be built. */
async function update() {
  db.tables.knowledge_map_builds = [];
  seedBuild(db, COURSE);
  await buildKnowledgeMap(COURSE);
  expect(db.tables.knowledge_map_builds[0]).toMatchObject({ status: "built" });
}

describe("updating a Knowledge map", () => {
  test("maps only new chunks, keeps ids and drops what deleted Materials taught", async () => {
    const [thrust, question, answer] = seedMaterial(
      db,
      COURSE,
      "Lecture 1",
      "parsed",
      [
        ["content", "Thrust is a force."],
        ["exercise", "Compute the thrust.", "7.1"],
        ["solution", "10 kN", "7.1"],
      ],
    );
    db.tables.exercise_solutions.push({
      course_id: COURSE,
      exercise_chunk_id: question,
      solution_chunk_id: answer,
    });
    const candidates = ["Thrust", "Drag", "Drag force"];
    let skeletons = 0;
    const { models, sent, embedded } = mapModel({
      // Each update names the existing big idea for its new candidate.
      skeleton: () => ({
        bigIdeas: [
          {
            name: "Propulsion",
            description: "Making thrust.",
            kcs: [{ name: candidates[skeletons++], description: "One line." }],
          },
        ],
      }),
      // The candidate follows the one KC the map has after the first update.
      assign: (call) => ({
        taught: { c1: [call === 0 ? "k1" : "k2"] },
        newKcs: [],
      }),
      alike: [["Drag", "Drag force"]],
      exercise: () => ({
        kcIds: ["k1"],
        newKcs: [],
        taskType: "compute thrust",
        solution: "Worked.",
        finalResult: "12 kN",
        finalAnswers: [{ label: "Thrust", value: 12, unit: "kN" }],
        givenFinalResult: "10 kN",
        matchesGiven: false,
        steps: 1,
      }),
    });
    useMockModels(models);

    await update();
    const firstKcs = db.tables.kcs.map(({ id, name }) => ({ id, name }));
    const exercise = db.tables.exercises[0]?.id;
    expect(firstKcs.map((kc) => kc.name)).toEqual(["Thrust"]);
    expect(db.tables.findings).toHaveLength(1);
    const firstCalls = sent.length;

    const [drag] = seedMaterial(db, COURSE, "Lecture 2", "parsed", [
      ["content", "Drag opposes motion."],
    ]);
    await update();
    expect(db.tables.kcs.map(({ id, name }) => ({ id, name }))).toEqual([
      ...firstKcs,
      { id: expect.any(String), name: "Drag" },
    ]);
    expect(db.tables.exercises.map((row) => row.id)).toEqual([exercise]);
    // The map's calls, without the Reading stage's.
    const secondCalls = sent
      .slice(firstCalls)
      .filter((input) => !("section" in input));
    expect(secondCalls.flatMap((input) => input.chunks ?? [])).toEqual([
      { id: "c1", label: "content", markdown: "Drag opposes motion." },
    ]);
    expect(secondCalls.find((input) => "bigIdea" in input)?.kcs).toEqual([
      expect.objectContaining({ name: "Drag" }),
    ]);
    expect(secondCalls.some((input) => "exercise" in input)).toBe(false);
    expect(db.tables.knowledge_map_chunks.map((row) => row.chunk_id)).toEqual([
      thrust,
      question,
      answer,
      drag,
    ]);

    // Drag is apart from Thrust: embedded, but no merge call.
    expect(embedded.flat().slice(-2)).toEqual([
      "Thrust: Sharp Thrust",
      "Drag: Sharp Drag",
    ]);
    expect(sent.some((input) => "clusters" in input)).toBe(false);

    const calls = sent.length;
    const embeds = embedded.length;
    await update();
    expect(sent).toHaveLength(calls);
    expect(embedded).toHaveLength(embeds);

    // Deleting Lecture 1 cascades its chunks and what cites them away.
    const gone = new Set([thrust, question, answer]);
    db.tables.materials = db.tables.materials.filter(
      (row) => row.name !== "Lecture 1",
    );
    for (const table of [
      "chunks",
      "kc_sources",
      "finding_sources",
      "knowledge_map_chunks",
    ] as const) {
      db.tables[table] = db.tables[table].filter(
        (row) => !gone.has(String(row.chunk_id ?? row.id)),
      );
    }
    db.tables.exercises = db.tables.exercises.filter(
      (row) => !gone.has(String(row.question_chunk_id)),
    );
    await update();
    expect(sent).toHaveLength(calls);
    expect(db.tables.kcs.map((row) => row.name)).toEqual(["Drag"]);
    expect(db.tables.findings).toEqual([]);

    // A new KC alike an existing one merges into it.
    const dragId = db.tables.kcs[0]?.id;
    const [dragForce] = seedMaterial(db, COURSE, "Lecture 3", "parsed", [
      ["content", "Drag force grows with speed."],
    ]);
    await update();
    expect(
      sent.findLast((input) => "clusters" in input)?.clusters,
    ).toMatchObject([{ kcs: [{ name: "Drag" }, { name: "Drag force" }] }]);
    expect(db.tables.kcs.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: dragId, name: "Drag" },
    ]);
    expect(db.tables.kc_sources.map((row) => row.chunk_id)).toEqual([
      drag,
      dragForce,
    ]);
    expect(db.tables.knowledge_map_builds[0]?.check_report).toMatchObject({
      duplicates: [],
    });
  });
});
