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
  bloom: null,
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
  priorKnowledge: ["p1", "p2"].map((id) => ({
    ...kc(id),
    type: "prior",
    origin: "prior",
  })),
  prerequisites: [
    { from: "p1", to: "k1", confidence: 0.9 },
    { from: "k1", to: "k2", confidence: 0.8 },
    { from: "k2", to: "k3", confidence: 0.7 },
    { from: "gone", to: "k3", confidence: 0.5 },
  ],
  semanticLinks: [
    { from: "k1", to: "k3", coreType: "causes", label: "drives" },
    { from: "k3", to: "p1", coreType: "is_a", label: "is a" },
  ],
  exercises: [
    {
      id: "e1",
      name: "Ex. 1",
      taskType: "calculate",
      kcs: ["p1", "k2"],
      solutionStatus: "disputed",
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

  test("puts each Big idea's KCs in its group, then prior knowledge and Exercises", () => {
    expect(graph.nodes).toEqual([
      { id: "b1", kind: "bigIdea" },
      { id: "k1", kind: "kc", parentId: "b1", prior: false },
      { id: "k2", kind: "kc", parentId: "b1", prior: false },
      { id: "b2", kind: "bigIdea" },
      { id: "k3", kind: "kc", parentId: "b2", prior: false },
      { id: "p1", kind: "kc", parentId: null, prior: true },
      { id: "p2", kind: "kc", parentId: null, prior: true },
      { id: "e1", kind: "exercise" },
    ]);
  });

  test("draws Prerequisites, Exercises' KCs and Semantic links between nodes it has", () => {
    expect(edges(graph, "prerequisite")).toEqual([
      ["p1", "k1"],
      ["k1", "k2"],
      ["k2", "k3"],
    ]);
    expect(edges(graph, "tests")).toEqual([
      ["p1", "e1"],
      ["k2", "e1"],
    ]);
    expect(edges(graph, "semantic")).toEqual([
      ["k1", "k3"],
      ["k3", "p1"],
    ]);
  });

  test("leaves out the layers toggled off", () => {
    const off = buildMapGraph(map, {
      ...DEFAULT_LAYERS,
      priorKnowledge: false,
      exercises: false,
      bigIdeaGroups: false,
      semanticLinks: { ...DEFAULT_LAYERS.semanticLinks, is_a: false },
    });
    expect(off.nodes).toEqual(
      ["k1", "k2", "k3"].map((id) => ({
        id,
        kind: "kc",
        parentId: null,
        prior: false,
      })),
    );
    expect(edges(off, "prerequisite")).toEqual([
      ["k1", "k2"],
      ["k2", "k3"],
    ]);
    expect(edges(off, "tests")).toEqual([]);
    expect(edges(off, "semantic")).toEqual([["k1", "k3"]]);
  });

  test("lays out again only when nodes change", () => {
    const key = (layers: MapLayers) =>
      JSON.stringify(toElkGraph(buildMapGraph(map, layers)));
    const base = key(DEFAULT_LAYERS);
    // Hidden Prerequisites still drive the layout; Semantic links never do.
    const hidden = buildMapGraph(map, {
      ...DEFAULT_LAYERS,
      prerequisites: false,
    });
    expect(
      hidden.edges.flatMap((e) => (e.kind === "prerequisite" ? e.hidden : [])),
    ).toEqual([true, true, true]);
    for (const layers of [
      { ...DEFAULT_LAYERS, prerequisites: false },
      { ...DEFAULT_LAYERS, solutionBadges: false },
      {
        ...DEFAULT_LAYERS,
        semanticLinks: { ...DEFAULT_LAYERS.semanticLinks, causes: false },
      },
    ]) {
      expect(key(layers)).toBe(base);
    }
    expect(key({ ...DEFAULT_LAYERS, exercises: false })).not.toBe(base);
  });
});

test("ELK places grouped KCs relative to their group, prior knowledge leftmost", async () => {
  const layouts = nodeLayouts(
    await new ELK().layout(toElkGraph(buildMapGraph(map))),
  );
  const at = (id: string) => layouts.get(id)!;
  const [b1, k1, k2, p1, p2] = [
    at("b1"),
    at("k1"),
    at("k2"),
    at("p1"),
    at("p2"),
  ];
  // Inside the group's box, measured from its corner.
  for (const child of [k1, k2]) {
    expect(child.x).toBeGreaterThan(0);
    expect(child.x + child.width).toBeLessThan(b1.width);
    expect(child.y + child.height).toBeLessThan(b1.height);
  }
  // Left to right in learning order.
  expect(k2.x).toBeGreaterThan(k1.x);
  // Prior knowledge leftmost, linked (p1) or not (p2).
  for (const prior of [p1, p2]) {
    expect(prior.x + prior.width).toBeLessThan(b1.x);
  }
  expect(layouts.get("b2")!.x).toBeGreaterThan(b1.x + b1.width);
  // An Exercise right of the KCs it tests.
  expect(at("e1").x).toBeGreaterThan(b1.x + k2.x + k2.width);
  expect(at("e1").parentId).toBeNull();
  expect(k1.parentId).toBe("b1");
});
