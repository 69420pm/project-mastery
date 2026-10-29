import { describe, expect, it } from "vitest";
import { kcPriorities, type KcPriority, type PriorityInput } from "./priority";

const kc = (
  id: string,
  topicId: string | null = null,
  sources = [`c-${id}`],
) => ({
  id,
  bigIdeaId: "b1",
  topicId,
  sources,
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
      notes: { name: "Notes", isExam: false },
      slides: { name: "Slides", isExam: false },
      sheet: { name: "Sheet", isExam: false },
      exam: { name: "Exam 2024", isExam: true },
    },
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

  it("lets a Topic's exam scope win over its Big idea's", () => {
    const result = byId(
      kcPriorities(
        input({
          examScopes: [
            {
              bigIdeaId: "b1",
              topicId: null,
              scope: "excluded",
              words: "No chapter 1",
            },
            {
              bigIdeaId: null,
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
            {
              bigIdeaId: "b1",
              topicId: null,
              scope: "emphasized",
              words: "All of it",
            },
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
