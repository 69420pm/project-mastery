import { describe, expect, test } from "vitest";
import { focusOn } from "./focus";
import type { MapGraphEdge, MapGraphNode } from "./map-graph";

// a → b → c → d, b → e, and Exercise x tests c.
const kc = (id: string, parentId: string | null = null): MapGraphNode => ({
  id,
  kind: "kc",
  parentId,
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
];
const focused = (id: string, depth: Parameters<typeof focusOn>[1]) => {
  const focus = focusOn(id, depth, nodes, edges);
  return { nodes: [...focus.nodes].sort(), edges: [...focus.edges].sort() };
};

describe("focus", () => {
  test("neighbours cross any shown edge, one step", () => {
    expect(focused("c", "neighbours")).toEqual({
      nodes: ["b", "c", "d", "x"],
      edges: ["bc", "cd", "cx"],
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
