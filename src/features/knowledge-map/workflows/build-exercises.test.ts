// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { markAdminClient } from "@/lib/supabase/admin-brand";
import type { Supabase } from "@/lib/supabase/types";
import {
  COURSE,
  chunkWith,
  createBuildDb,
  deleteMaterial,
  pair,
  queueBuild,
  seedMaterial,
  useBuildModels,
} from "./build-testing";

/**
 * Update map's Exercises in-process, with mock `map`, `exercise` and
 * `embed` models: one call per exercise Part, stored by question chunk and
 * extracted again in place when its pair changes.
 */

vi.mock("server-only", () => ({}));

let db = createBuildDb();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));

const { buildKnowledgeMap } = await import("./build-knowledge-map");

async function update() {
  queueBuild(db);
  await buildKnowledgeMap(COURSE);
}

const STATEMENT = "Find the dimension of U.";
const SOLUTION = "dim U = 2.";

const kcNamesOf = (exerciseId: unknown) =>
  db.tables.exercise_kcs
    .filter((link) => link.exercise_id === exerciseId)
    .map((link) => db.tables.kcs.find((kc) => kc.id === link.kc_id)!.name);

beforeEach(() => {
  db = createBuildDb();
  seedMaterial(db, { parts: [{ title: "Dimension" }] });
});

describe("Update map's Exercises", () => {
  test("stores each subtask with its KCs, printed solution, final answers and difficulty", async () => {
    seedMaterial(db, {
      parts: [
        {
          title: "Sheet 2",
          kind: "exercise",
          chunks: [
            { markdown: STATEMENT, number: "10" },
            { markdown: "Work in pairs.", number: "11" },
            { markdown: SOLUTION, label: "solution" },
          ],
        },
        // Solutions alone make no call.
        {
          title: "Solutions",
          kind: "exercise",
          chunks: [{ markdown: "Other.", label: "solution" }],
        },
      ],
    });
    pair(db, STATEMENT, SOLUTION);
    const { exercises } = useBuildModels({
      subtaskOf: (subtask) =>
        subtask.number === "10"
          ? {
              kcs: ["Dimension", "Unknown"],
              newKcs: ["Basis of a subspace"],
              finalAnswers: [{ label: "dim U", value: 2, unit: null }],
            }
          : { notAnExercise: true },
    });

    await update();

    expect(exercises).toHaveLength(1);
    expect(exercises[0]!.subtasks).toEqual([
      { id: "s1", number: "10", statement: STATEMENT, solution: SOLUTION },
      { id: "s2", number: "11", statement: "Work in pairs.", solution: null },
    ]);
    expect(db.tables.exercises).toEqual([
      expect.objectContaining({
        question_chunk_id: chunkWith(db, STATEMENT),
        solution_chunk_id: chunkWith(db, SOLUTION),
        final_answers: [{ label: "dim U", value: 2, unit: null }],
        difficulty: 2,
      }),
    ]);
    expect(kcNamesOf(db.tables.exercises[0]!.id)).toEqual([
      "Dimension",
      "Basis of a subspace",
    ]);
    // The new KC is consolidated and cites the statement.
    const added = db.tables.kcs.find((kc) => kc.name === "Basis of a subspace");
    expect(added).toMatchObject({ origin: "exercise" });
    expect(
      db.tables.kc_sources.filter((source) => source.kc_id === added!.id),
    ).toEqual([
      expect.objectContaining({ chunk_id: chunkWith(db, STATEMENT) }),
    ]);

    const again = useBuildModels();
    await update();
    expect(again.exercises).toEqual([]);
  });

  test("extracts an Exercise again in place when its solution comes later or goes", async () => {
    seedMaterial(db, {
      parts: [{ title: "Sheet 2", kind: "exercise", chunks: [STATEMENT] }],
    });
    useBuildModels({ subtaskOf: () => ({ kcs: ["Dimension"] }) });
    await update();
    const [exercise] = db.tables.exercises;
    expect(exercise).toMatchObject({ solution_chunk_id: null, difficulty: 1 });
    db.tables.attempts.push({ exercise_id: exercise!.id, result: "full" });

    const solutions = seedMaterial(db, {
      parts: [
        {
          title: "Solutions",
          kind: "exercise",
          chunks: [{ markdown: SOLUTION, label: "solution" }],
        },
      ],
    });
    pair(db, STATEMENT, SOLUTION);
    const later = useBuildModels({
      subtaskOf: (subtask) => ({
        kcs: ["Dimension"],
        finalAnswers: subtask.solution
          ? [{ label: "dim U", value: 2, unit: null }]
          : [],
      }),
    });
    await update();

    expect(later.exercises).toHaveLength(1);
    expect(db.tables.exercises).toEqual([
      expect.objectContaining({
        id: exercise!.id,
        solution_chunk_id: chunkWith(db, SOLUTION),
        final_answers: [{ label: "dim U", value: 2, unit: null }],
      }),
    ]);
    expect(db.tables.attempts).toHaveLength(1);

    deleteMaterial(db, solutions);
    const gone = useBuildModels({ subtaskOf: () => ({ kcs: ["Dimension"] }) });
    await update();

    expect(gone.exercises[0]!.subtasks[0]!.solution).toBeNull();
    expect(db.tables.exercises).toEqual([
      expect.objectContaining({
        id: exercise!.id,
        solution_chunk_id: null,
        final_answers: null,
      }),
    ]);
  });
});
