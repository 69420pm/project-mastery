import { describe, expect, test } from "vitest";
import { planMap, type PlanPart } from "./map-plan";

/** A Part with one chunk per KC, in Course order; its hash is its title. */
const part = (
  title: string,
  kcCount: number,
  chapter = "Vectors",
  kind: PlanPart["kind"] = "teaching",
) => ({ title, kcCount, chapter, kind });

/** The plan of Parts whose KCs are "<title><n>", each sourced in its own chunk. */
function plan(
  specs: ReturnType<typeof part>[],
  exercises: string[][] = [],
  prerequisites: Array<{ from: string; to: string }> = [],
) {
  const parts = specs.map((spec) => ({
    id: spec.title,
    kind: spec.kind,
    title: spec.title,
    chapterTitle: spec.chapter,
    contentHash: spec.title,
  }));
  const kcIds = specs.flatMap((spec) =>
    Array.from({ length: spec.kcCount }, (_, n) => `${spec.title}${n + 1}`),
  );
  return planMap({
    parts,
    chunks: specs.flatMap((spec) =>
      Array.from({ length: spec.kcCount }, (_, n) => ({
        id: `chunk ${spec.title}${n + 1}`,
        partId: spec.title,
        chapter: spec.chapter,
      })),
    ),
    kcs: kcIds.map((id) => ({ id, sources: [`chunk ${id}`] })),
    exercises,
    prerequisites,
  });
}

const topics = (result: ReturnType<typeof plan>) =>
  result.topics.map((topic) => [topic.partHashes, topic.kcs.length]);

describe("planMap", () => {
  test("a Part of 3 KCs is a Topic; a smaller one joins the previous Topic of its chapter, else the next", () => {
    expect(
      topics(
        plan([
          part("A", 1),
          part("B", 3),
          part("C", 2),
          part("D", 1, "Bases"),
          part("E", 4, "Bases"),
        ]),
      ),
    ).toEqual([
      [["A", "B", "C"], 6],
      [["D", "E"], 5],
    ]);
  });

  test("small Parts of a chapter without a Topic form one together", () => {
    expect(topics(plan([part("A", 1), part("B", 2)]))).toEqual([
      [["A", "B"], 3],
    ]);
  });

  test("a Part of more than 10 KCs splits in two by source order", () => {
    const result = plan([part("A", 11)]);
    expect(topics(result)).toEqual([
      [["A/1"], 6],
      [["A/2"], 5],
    ]);
    expect(result.topics[1]!.kcs[0]).toBe("A7");
  });

  test("one Big idea per chapter, and every KC in its Topic's", () => {
    const result = plan([part("A", 3), part("B", 3, "Bases")]);
    expect(result.bigIdeas).toEqual(["Vectors", "Bases"]);
    expect(result.kcs.at(-1)).toEqual({ id: "B3", bigIdea: "Bases" });
    expect(result.topics.map((topic) => topic.partTitles)).toEqual([
      ["A"],
      ["B"],
    ]);
  });

  test("an exercise KC joins the Topic holding most of its Exercise's other KCs, else stays with its Part", () => {
    const result = plan(
      [
        part("A", 3),
        part("B", 3, "Bases"),
        part("X", 4, "Sheet 1", "exercise"),
      ],
      [["X1", "B1", "B2", "A1"], ["X2"]],
    );
    expect(result.topics.find((t) => t.kcs.includes("X1"))?.partHashes).toEqual(
      ["B"],
    );
    expect(result.kcs.find((kc) => kc.id === "X1")?.bigIdea).toBe("Bases");
    expect(result.topics.find((t) => t.kcs.includes("X2"))?.partHashes).toEqual(
      ["X"],
    );
  });

  test("Topics and their KCs put Prerequisites first", () => {
    const result = plan(
      [part("A", 3), part("B", 3)],
      [],
      [
        { from: "B1", to: "A1" },
        { from: "A3", to: "A2" },
      ],
    );
    expect(result.topics.map((topic) => topic.kcs)).toEqual([
      ["B1", "B2", "B3"],
      ["A1", "A3", "A2"],
    ]);
  });
});
