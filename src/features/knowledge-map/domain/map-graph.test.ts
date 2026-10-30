import ELK from "elkjs/lib/elk.bundled.js";
import { describe, expect, test } from "vitest";
import type { KcView, KnowledgeMapView } from "@/features/knowledge-map/types";
import {
  buildMapGraph,
  DEFAULT_LAYERS,
  type MapGraph,
  type MapGraphEdge,
  type MapLayers,
  nodeLayouts,
  toElkGraph,
} from "./map-graph";

const kc = (id: string): KcView => ({
  id,
  name: id,
  description: id,
  type: "concept",
  origin: "content",
  sources: [],
});

const map: KnowledgeMapView = {
  courseId: "c1",
  build: null,
  bigIdeas: [
    { id: "b1", name: "Thrust", description: "", kcs: [kc("k1"), kc("k2")] },
    { id: "b2", name: "Nozzles", description: "", kcs: [kc("k3")] },
    { id: "b3", name: "Empty", description: "", kcs: [] },
  ],
  prerequisites: [
    { from: "k1", to: "k2" },
    { from: "k2", to: "k3" },
    { from: "gone", to: "k3" },
  ],
  exercises: [
    {
      id: "e1",
      name: "Sheet 1 p. 2",
      kcs: ["k1", "k2"],
      difficulty: 2,
      question: "Q",
      solution: "S",
    },
  ],
  checkReport: null,
  canBuild: true,
};

const edges = (graph: MapGraph, kind: MapGraphEdge["kind"]) =>
  graph.edges.filter((e) => e.kind === kind).map((e) => [e.source, e.target]);

describe("buildMapGraph", () => {
  const graph = buildMapGraph(map);

  test("puts each Big idea's KCs in its group, then Exercises", () => {
    expect(graph.nodes).toEqual([
      { id: "b1", kind: "bigIdea" },
      { id: "k1", kind: "kc", parentId: "b1" },
      { id: "k2", kind: "kc", parentId: "b1" },
      { id: "b2", kind: "bigIdea" },
      { id: "k3", kind: "kc", parentId: "b2" },
      { id: "e1", kind: "exercise" },
    ]);
  });

  test("draws Prerequisites and Exercises' KCs between nodes it has", () => {
    expect(edges(graph, "prerequisite")).toEqual([
      ["k1", "k2"],
      ["k2", "k3"],
    ]);
    expect(edges(graph, "tests")).toEqual([
      ["k1", "e1"],
      ["k2", "e1"],
    ]);
  });

  test("leaves out the layers toggled off", () => {
    const off = buildMapGraph(map, {
      ...DEFAULT_LAYERS,
      exercises: false,
      bigIdeaGroups: false,
    });
    expect(off.nodes).toEqual(
      ["k1", "k2", "k3"].map((id) => ({ id, kind: "kc", parentId: null })),
    );
    expect(edges(off, "tests")).toEqual([]);
  });

  test("lays out again only when nodes change", () => {
    const key = (layers: MapLayers) =>
      JSON.stringify(toElkGraph(buildMapGraph(map, layers)));
    const base = key(DEFAULT_LAYERS);
    // Hidden Prerequisites still drive the layout.
    const hidden = buildMapGraph(map, {
      ...DEFAULT_LAYERS,
      prerequisites: false,
    });
    expect(
      hidden.edges.flatMap((e) => (e.kind === "prerequisite" ? e.hidden : [])),
    ).toEqual([true, true]);
    expect(key({ ...DEFAULT_LAYERS, prerequisites: false })).toBe(base);
    expect(key({ ...DEFAULT_LAYERS, exercises: false })).not.toBe(base);
  });
});

test("ELK places grouped KCs relative to their group, in learning order", async () => {
  const layouts = nodeLayouts(
    await new ELK().layout(toElkGraph(buildMapGraph(map))),
  );
  const at = (id: string) => layouts.get(id)!;
  const [b1, k1, k2] = [at("b1"), at("k1"), at("k2")];
  // Inside the group's box, measured from its corner.
  for (const child of [k1, k2]) {
    expect(child.x).toBeGreaterThan(0);
    expect(child.x + child.width).toBeLessThan(b1.width);
    expect(child.y + child.height).toBeLessThan(b1.height);
  }
  // Left to right in learning order.
  expect(k2.x).toBeGreaterThan(k1.x);
  expect(layouts.get("b2")!.x).toBeGreaterThan(b1.x + b1.width);
  // An Exercise right of the KCs it tests.
  expect(at("e1").x).toBeGreaterThan(b1.x + k2.x + k2.width);
  expect(at("e1").parentId).toBeNull();
  expect(k1.parentId).toBe("b1");
});
