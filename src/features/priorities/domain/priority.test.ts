import { describe, expect, it } from "vitest";
import { kcPriorities, type KcPriority, type PriorityInput } from "./priority";

const kc = (
  id: string,
  topicId: string | null = null,
  sources = [`c-${id}`],
) => ({
  id,
  // Every Topic sits in the top-level Topic "top".
  topics: topicId === null ? [] : [topicId, "top"],
  sources,
  name: `KC ${id}`,
  prerequisites: [] as string[],
});

function input(overrides: Partial<PriorityInput> = {}): PriorityInput {
  return {
    kcs: [kc("a", "t1"), kc("b", "t1"), kc("c", "t2")],
    exercises: [],
    chunkMaterials: {
      "c-a": "notes",
      "c-b": "notes",
      "c-c": "slides",
      q1: "exam",
      q2: "sheet",
      q3: "sheet",
    },
    materials: {
      notes: { name: "Notes" },
      slides: { name: "Slides" },
      sheet: { name: "Sheet" },
      exam: { name: "Exam 2024" },
    },
    examChunkIds: ["q1"],
    excludedMaterialIds: [],
    examScopes: [],
    ...overrides,
  };
}

const byId = (values: KcPriority[]) =>
  Object.fromEntries(values.map((value) => [value.kcId, value])) as Record<
    "a" | "b" | "c",
    KcPriority
  >;

describe("kcPriorities", () => {
  it("gives every KC 0.25 without old exams, Exercises or exam scopes", () => {
    expect(kcPriorities(input()).map((value) => value.priority)).toEqual([
      0.25, 0.25, 0.25,
    ]);
  });

  it("weighs old-exam and all Exercises as shares of the Course's most", () => {
    const result = byId(
      kcPriorities(
        input({
          exercises: [
            { questionChunk: "q1", kcs: ["a", "a"] },
            { questionChunk: "q2", kcs: ["a", "b"] },
            { questionChunk: "q3", kcs: ["b"] },
          ],
        }),
      ),
    );
    expect(result.a.priority).toBe(0.25 + 0.5 + 0.25);
    expect(result.b.priority).toBe(0.25 + 0.25);
    expect(result.c.priority).toBe(0.25);
    expect(result.a.reasons).toEqual([
      "Tested in 1 old-exam Exercise",
      "Tested in 2 Exercises",
    ]);
    expect([result.a.level, result.b.level, result.c.level]).toEqual([
      "high",
      "medium",
      "low",
    ]);
  });

  it("lets a Topic take its own exam scope, else the nearest one up its ancestors", () => {
    const result = byId(
      kcPriorities(
        input({
          examScopes: [
            {
              topicId: "top",
              scope: "excluded",
              words: "No chapter 1",
            },
            {
              topicId: "t1",
              scope: "emphasized",
              words: "Bases come up a lot",
            },
          ],
        }),
      ),
    );
    expect(result.a.priority).toBe(0.5);
    expect(result.a.reasons).toEqual([
      "Emphasized in the Brief: Bases come up a lot",
    ]);
    expect(result.c).toMatchObject({
      priority: 0,
      level: "excluded",
      reasons: ["Excluded in the Brief: No chapter 1"],
    });
  });

  it("excludes a KC whose every source is in an excluded Material", () => {
    const result = byId(
      kcPriorities(
        input({
          kcs: [kc("a", null, ["c-a", "c-c"]), kc("c")],
          excludedMaterialIds: ["notes", "slides"],
          examScopes: [
            { topicId: "top", scope: "emphasized", words: "All of it" },
          ],
        }),
      ),
    );
    expect(result.a).toMatchObject({
      priority: 0,
      level: "excluded",
      reasons: ["Excluded: you skip Notes, Slides"],
    });
    expect(result.c.priority).toBe(0);
  });

  it("lifts a KC to the Priority of what builds on it, through a chain", () => {
    const result = kcPriorities(
      input({
        kcs: [
          { ...kc("a"), prerequisites: [] },
          { ...kc("b"), prerequisites: ["a"] },
          { ...kc("c"), prerequisites: ["b"] },
        ],
        exercises: [{ questionChunk: "q1", kcs: ["c"] }],
      }),
    );
    expect(result.map((value) => value.priority)).toEqual([1, 1, 1]);
    expect(result[0]?.reasons).toEqual(["Needed for KC b"]);
    expect(result[1]?.reasons).toEqual(["Needed for KC c"]);
  });

  it("keeps an excluded KC at 0 when something builds on it", () => {
    const result = kcPriorities(
      input({
        kcs: [kc("a"), { ...kc("b"), prerequisites: ["a"] }],
        excludedMaterialIds: ["notes"],
        chunkMaterials: { "c-a": "notes", "c-b": "slides" },
      }),
    );
    expect(result[0]).toMatchObject({ priority: 0, level: "excluded" });
    expect(result[1]?.priority).toBe(0.25);
  });

  it("gives a KC without sources exactly what builds on it", () => {
    const result = kcPriorities(
      input({
        kcs: [
          kc("a", null, []),
          { ...kc("b"), prerequisites: ["a"] },
          { ...kc("c"), prerequisites: ["a"] },
        ],
        examScopes: [],
        exercises: [{ questionChunk: "q1", kcs: ["b"] }],
      }),
    );
    expect(result[0]).toMatchObject({
      priority: 1,
      reasons: ["Needed for KC b"],
    });
  });

  it("gives a KC without sources 0 under excluded KCs", () => {
    const result = kcPriorities(
      input({
        kcs: [kc("a", null, []), { ...kc("b"), prerequisites: ["a"] }],
        excludedMaterialIds: ["notes"],
      }),
    );
    expect(result[0]).toMatchObject({ priority: 0, level: "excluded" });
  });

  it("keeps a KC with one source outside the excluded Materials", () => {
    const result = kcPriorities(
      input({
        kcs: [kc("a", null, ["c-a", "c-c"])],
        excludedMaterialIds: ["notes"],
      }),
    );
    expect(result[0]).toMatchObject({ priority: 0.25, level: "high" });
  });
});
