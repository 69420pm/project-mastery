import ELK from "elkjs/lib/elk.bundled.js";
import { describe, expect, test } from "vitest";
import type { KcView, KnowledgeMapView } from "@/features/knowledge-map/types";
import { buildMapGraph, nodeLayouts, toElkGraph } from "./map-graph";

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
  semanticLinks: [],
  exercises: [],
  checkReport: null,
  canBuild: true,
};

describe("buildMapGraph", () => {
  const graph = buildMapGraph(map);

  test("puts each Big idea's KCs in its group and prior knowledge outside", () => {
    expect(graph.nodes).toEqual([
      { id: "b1", kind: "bigIdea" },
      { id: "k1", kind: "kc", parentId: "b1" },
      { id: "k2", kind: "kc", parentId: "b1" },
      { id: "b2", kind: "bigIdea" },
      { id: "k3", kind: "kc", parentId: "b2" },
      { id: "p1", kind: "kc", parentId: null },
      { id: "p2", kind: "kc", parentId: null },
    ]);
  });

  test("draws the Prerequisites between nodes it has", () => {
    expect(graph.edges.map((e) => [e.source, e.target])).toEqual([
      ["p1", "k1"],
      ["k1", "k2"],
      ["k2", "k3"],
    ]);
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
});
