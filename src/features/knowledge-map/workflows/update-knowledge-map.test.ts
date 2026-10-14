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
    const { model, sent } = mapModel({
      // The update names the existing big idea for its new candidate.
      skeleton: (input: { existingBigIdeas: unknown[] }) => ({
        bigIdeas: [
          {
            name: "Propulsion",
            description: "Making thrust.",
            kcs: [
              {
                name: input.existingBigIdeas.length > 0 ? "Drag" : "Thrust",
                description: "One line.",
              },
            ],
          },
        ],
      }),
      assign: (call) => ({
        taught: { c1: [call === 0 ? "k1" : "k2"] },
        newKcs: [],
      }),
      exercise: () => ({
        kcIds: ["k1"],
        newKcs: [],
        taskType: "compute thrust",
        solution: "Worked.",
        finalResult: "12 kN",
        givenFinalResult: "10 kN",
        matchesGiven: false,
        steps: 1,
      }),
    });
    useMockModels({ map: model, exercise: model });

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
    const secondCalls = sent.slice(firstCalls);
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

    const calls = sent.length;
    await update();
    expect(sent).toHaveLength(calls);

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
  });
});
