import ELK from "elkjs/lib/elk.bundled.js";
import { expect, test } from "vitest";
import type { MapTopic } from "@/features/knowledge-map/types";
import { nodeLayouts } from "./map-graph";
import { buildTopicGraph, toElkTopicGraph } from "./topic-graph";

/** A Topic of Big idea `bigIdeaId` holding the KCs `kcs`. */
const topic = (id: string, bigIdeaId: string, kcs: string[]): MapTopic => ({
  id,
  bigIdeaId,
  name: id,
  centralQuestion: `Why ${id}?`,
  kcs: kcs.map((kc) => ({ id: kc, name: kc })),
});

const bigIdeas = [
  { id: "b1", name: "Thrust", description: "", kcs: [] },
  { id: "b2", name: "Nozzles", description: "", kcs: [] },
  { id: "b3", name: "Empty", description: "", kcs: [] },
];

const prerequisite = (from: string, to: string) => ({
  from,
  to,
  confidence: 0.9,
});

/** The arrows as "source>target". */
const arrows = (topics: MapTopic[], links: Array<[string, string]>) =>
  buildTopicGraph(topics, {
    bigIdeas,
    prerequisites: links.map(([from, to]) => prerequisite(from, to)),
  }).edges.map((edge) => `${edge.source}>${edge.target}`);

test("each Big idea with Topics is a group of its Topics in Course order", () => {
  const graph = buildTopicGraph(
    [
      topic("t2", "b2", ["k3"]),
      topic("t1", "b1", ["k1"]),
      topic("t3", "b2", []),
    ],
    { bigIdeas, prerequisites: [] },
  );
  expect(
    graph.nodes.map((node) =>
      node.kind === "bigIdea" ? node.name : `${node.id} in ${node.parentId}`,
    ),
  ).toEqual(["Thrust", "t1 in b1", "Nozzles", "t2 in b2", "t3 in b2"]);
});

test("a Prerequisite between two Topics' KCs is one arrow; prior knowledge and links inside a Topic none", () => {
  const topics = [topic("t1", "b1", ["k1", "k2"]), topic("t2", "b2", ["k3"])];
  expect(
    arrows(topics, [
      ["k1", "k2"],
      ["k1", "k3"],
      ["k2", "k3"],
      ["p1", "k1"],
    ]),
  ).toEqual(["t1>t2"]);
});

test("an arrow another path implies is dropped", () => {
  const topics = [
    topic("t1", "b1", ["k1"]),
    topic("t2", "b1", ["k2"]),
    topic("t3", "b2", ["k3"]),
  ];
  expect(
    arrows(topics, [
      ["k1", "k2"],
      ["k2", "k3"],
      ["k1", "k3"],
    ]),
  ).toEqual(["t1>t2", "t2>t3"]);
});

test("arrows on a cycle all stay, and so does one into the cycle", () => {
  // t2 and t3 need each other through different KCs.
  const topics = [
    topic("t1", "b1", ["k1"]),
    topic("t2", "b1", ["k2", "k4"]),
    topic("t3", "b2", ["k3", "k5"]),
  ];
  expect(
    arrows(topics, [
      ["k1", "k2"],
      ["k1", "k3"],
      ["k2", "k3"],
      ["k5", "k4"],
    ]),
  ).toEqual(["t1>t2", "t1>t3", "t2>t3", "t3>t2"]);
});

test("ELK places Topics inside their Big idea's box", async () => {
  const graph = buildTopicGraph(
    [topic("t1", "b1", ["k1"]), topic("t2", "b2", ["k2"])],
    { bigIdeas, prerequisites: [prerequisite("k1", "k2")] },
  );
  const layouts = nodeLayouts(await new ELK().layout(toElkTopicGraph(graph)));
  expect(layouts.get("t1")?.parentId).toBe("b1");
  expect(layouts.get("t2")?.parentId).toBe("b2");
  expect(layouts.get("b1")!.x).toBeLessThan(layouts.get("b2")!.x);
});
