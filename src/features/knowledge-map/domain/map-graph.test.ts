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
  origin: "content",
  sources: [],
});

const map: KnowledgeMapView = {
  courseId: "c1",
  build: null,
  kcs: [kc("k1"), kc("k2"), kc("k3")],
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

  test("puts the KCs first, then Exercises", () => {
    expect(graph.nodes).toEqual([
      { id: "k1", kind: "kc" },
      { id: "k2", kind: "kc" },
      { id: "k3", kind: "kc" },
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
    const off = buildMapGraph(map, { ...DEFAULT_LAYERS, exercises: false });
    expect(off.nodes).toEqual(
      ["k1", "k2", "k3"].map((id) => ({ id, kind: "kc" })),
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

test("ELK places the KCs in learning order", async () => {
  const layouts = nodeLayouts(
    await new ELK().layout(toElkGraph(buildMapGraph(map))),
  );
  const at = (id: string) => layouts.get(id)!;
  const [k1, k2, k3] = [at("k1"), at("k2"), at("k3")];
  // Left to right in learning order.
  expect(k2.x).toBeGreaterThan(k1.x);
  expect(k3.x).toBeGreaterThan(k2.x);
  // An Exercise right of the KCs it tests.
  expect(at("e1").x).toBeGreaterThan(k2.x + k2.width);
  expect(at("e1").parentId).toBeNull();
});
