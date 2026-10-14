import { describe, expect, test } from "vitest";
import type { KnowledgeMap } from "@/features/knowledge-map/schemas";
import {
  clustersOf,
  DEDUP_THRESHOLD,
  remainingDuplicates,
  similarPairs,
  withMerges,
} from "./dedup";

const kc = (id: string, sources: string[]): KnowledgeMap["kcs"][number] => ({
  id,
  name: id.toUpperCase(),
  description: ".",
  type: "concept",
  bloom: "apply",
  bigIdea: id.startsWith("a") ? "A" : "B",
  origin: "content",
  sources,
});

/** A unit vector at `cosine` to [1, 0]. */
const at = (cosine: number) => [cosine, Math.sqrt(1 - cosine * cosine)];

describe("similarPairs and clustersOf", () => {
  test("pair new KCs at or above the threshold and join pairs into clusters", () => {
    const kcs = ["old", "new1", "new2", "far"].map((id) => ({
      id,
      origin: "content",
    }));
    const pairs = similarPairs(
      kcs,
      [[1, 0], at(DEDUP_THRESHOLD), at(DEDUP_THRESHOLD - 0.01), [0, 1]],
      new Set(["new1", "new2", "far"]),
    );
    // new2 is just below the threshold with old, but close to new1.
    expect(pairs.map(({ a, b }) => `${a}-${b}`)).toEqual([
      "old-new1",
      "new1-new2",
    ]);
    expect(clustersOf(pairs, ["far", "new2", "new1", "old"])).toEqual([
      ["new2", "new1", "old"],
    ]);
  });

  test("never pair two KCs that existed before the update", () => {
    const kcs = [
      { id: "old1", origin: "content" },
      { id: "old2", origin: "content" },
    ];
    expect(similarPairs(kcs, [[1], [1]], new Set())).toEqual([]);
  });
});

describe("withMerges", () => {
  const map: KnowledgeMap = {
    bigIdeas: [
      { id: "A", name: "A", description: "." },
      { id: "B", name: "B", description: "." },
    ],
    kcs: [kc("a1", ["c1"]), kc("a2", ["c2"]), kc("b1", ["c2", "c3"])],
    prerequisites: [
      { from: "a1", to: "a2", extractionConfidence: 0.5 },
      { from: "a2", to: "b1", extractionConfidence: 0.7 },
    ],
    semanticLinks: [{ from: "b1", to: "a1", coreType: "other", label: "same" }],
    exercises: [
      {
        id: "e1",
        name: "Ex. 1",
        questionChunk: "c4",
        taskType: "compute",
        solutionStatus: "given",
        solution: null,
        difficulty: 1,
        kcs: ["a1", "b1"],
      },
    ],
    findings: [],
  };

  test("keeps the existing KC's id and joins sources, links and Exercise KCs", () => {
    const merged = withMerges(map, [["b1", "a1"]], new Set(["a1", "a2"]));
    expect(merged.map.kcs.map(({ id, sources }) => ({ id, sources }))).toEqual([
      { id: "a1", sources: ["c1", "c2", "c3"] },
      { id: "a2", sources: ["c2"] },
    ]);
    // a2→b1 became a2→a1, a cycle with a1→a2: its weaker edge goes.
    expect(merged.map.prerequisites).toEqual([
      { from: "a2", to: "a1", extractionConfidence: 0.7 },
    ]);
    expect(merged.droppedCycleEdges).toEqual([
      { from: "a1", to: "a2", extractionConfidence: 0.5 },
    ]);
    // The semantic link became a self-link and went.
    expect(merged.map.semanticLinks).toEqual([]);
    expect(merged.map.exercises[0]?.kcs).toEqual(["a1"]);
    expect(merged.map.bigIdeas.map((bigIdea) => bigIdea.id)).toEqual(["A"]);
    expect(merged.merges).toEqual([{ kept: "A1", merged: ["B1"] }]);
  });

  test("between new KCs the first in map order stays, and two existing ones stay apart", () => {
    expect(
      withMerges(map, [["b1", "a2"]], new Set()).map.kcs.map((k) => k.id),
    ).toEqual(["a1", "a2"]);
    expect(
      withMerges(map, [["a1", "a2"]], new Set(["a1", "a2"])).merges,
    ).toEqual([]);
  });

  test("reports pairs whose KCs both remain", () => {
    expect(
      remainingDuplicates({ kcs: [kc("a1", []), kc("a2", [])] }, [
        { a: "a1", b: "a2", similarity: 0.91234 },
        { a: "a1", b: "b1", similarity: 0.9 },
      ]),
    ).toEqual([{ a: "A1", b: "A2", similarity: 0.912 }]);
  });
});
