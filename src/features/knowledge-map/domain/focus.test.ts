import { describe, expect, test } from "vitest";
import { checkItems, focusOn, kcIdsNamed } from "./focus";
import type { MapGraphEdge, MapGraphNode } from "./map-graph";

// a → b → c → d, b → e, Exercise x tests c, and a semantic link e – d.
const kc = (id: string, parentId: string | null = null): MapGraphNode => ({
  id,
  kind: "kc",
  parentId,
  prior: false,
});
const nodes = [kc("a"), kc("b", "g"), kc("c", "g"), kc("d"), kc("e")];
const prerequisite = (source: string, target: string): MapGraphEdge => ({
  id: `${source}${target}`,
  kind: "prerequisite",
  source,
  target,
  hidden: false,
});
const edges: MapGraphEdge[] = [
  prerequisite("a", "b"),
  prerequisite("b", "c"),
  prerequisite("c", "d"),
  prerequisite("b", "e"),
  { id: "cx", kind: "tests", source: "c", target: "x" },
  {
    id: "ed",
    kind: "semantic",
    source: "e",
    target: "d",
    coreType: "causes",
    label: "causes",
  },
];
const focused = (id: string, depth: Parameters<typeof focusOn>[1]) => {
  const focus = focusOn(id, depth, nodes, edges);
  return { nodes: [...focus.nodes].sort(), edges: [...focus.edges].sort() };
};

describe("focus", () => {
  test("neighbours cross any shown edge, one step", () => {
    expect(focused("e", "neighbours")).toEqual({
      nodes: ["b", "d", "e"],
      edges: ["be", "ed"],
    });
  });

  test("upstream and downstream follow Prerequisites and Exercises transitively", () => {
    expect(focused("c", "upstream").nodes).toEqual(["a", "b", "c"]);
    expect(focused("b", "downstream")).toEqual({
      nodes: ["b", "c", "d", "e", "x"],
      edges: ["bc", "be", "cd", "cx"],
    });
    expect(focused("x", "upstream").nodes).toEqual(["a", "b", "c", "x"]);
    expect(focused("c", "both").nodes).toEqual(["a", "b", "c", "d", "x"]);
  });

  test("a Big idea focuses from its KCs", () => {
    expect(focused("g", "upstream").nodes).toEqual(["a", "b", "c", "g"]);
  });

  test("an edge left out is not crossed", () => {
    const shown = edges.filter((edge) => edge.id !== "bc");
    expect([...focusOn("d", "upstream", nodes, shown).nodes].sort()).toEqual([
      "c",
      "d",
    ]);
  });
});

describe("the check report", () => {
  const report = {
    uncoveredChunks: ["p. 3"],
    ungroundedKcs: [],
    orphanKcs: ["Thrust"],
    droppedCycleEdges: [
      { from: "Lift", to: "Drag", extractionConfidence: 0.5 },
    ],
    unmappedExercises: ["Ex. 1"],
    untestedKcs: [],
    duplicates: [{ a: "Lift", b: "Thrust", similarity: 0.9 }],
  };

  test("lists the items that name KCs", () => {
    expect(checkItems(report).map((item) => [item.key, item.kcNames])).toEqual([
      ["orphan", ["Thrust"]],
      ["cycles", ["Lift", "Drag"]],
      ["duplicates", ["Lift", "Thrust"]],
    ]);
  });

  test("matches KCs by exact name, every KC sharing it", () => {
    const kcs = [
      { id: "1", name: "Thrust" },
      { id: "2", name: "Thrust" },
      { id: "3", name: "thrust" },
    ];
    expect([...kcIdsNamed(kcs, ["Thrust"])]).toEqual(["1", "2"]);
  });
});
