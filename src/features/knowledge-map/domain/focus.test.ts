import { describe, expect, test } from "vitest";
import { focusOn } from "./focus";
import type { MapGraphEdge } from "./map-graph";

// a → b → c → d, b → e, and Exercise x tests c.
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
  const focus = focusOn(id, depth, edges);
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

  test("an edge left out is not crossed", () => {
    const shown = edges.filter((edge) => edge.id !== "bc");
    expect([...focusOn("d", "upstream", shown).nodes].sort()).toEqual([
      "c",
      "d",
    ]);
  });
});
