import ELK from "elkjs/lib/elk.bundled.js";
import { expect, test } from "vitest";
import type { MapTopic } from "@/features/knowledge-map/types";
import { nodeLayouts } from "./map-graph";
import { boxId, buildTopicGraph, toElkTopicGraph } from "./topic-graph";

/** A Topic in `parentId` holding the KCs `kcs` itself. */
const topic = (
  id: string,
  kcs: string[],
  parentId: string | null = null,
): MapTopic => ({
  id,
  parentId,
  name: id,
  centralQuestion: kcs.length > 0 ? `Why ${id}?` : null,
  kcs: kcs.map((kc) => ({ id: kc, name: kc })),
});

const prerequisite = (from: string, to: string) => ({ from, to });

/** The arrows as "source>target". */
const arrows = (topics: MapTopic[], links: Array<[string, string]>) =>
  buildTopicGraph(topics, {
    prerequisites: links.map(([from, to]) => prerequisite(from, to)),
  }).edges.map((edge) => `${edge.source}>${edge.target}`);

test("a Topic with children is a box holding its own card and its children, to any depth", () => {
  const graph = buildTopicGraph(
    [
      topic("spaces", ["k1"]),
      topic("bases", ["k2"], "spaces"),
      topic("sums", [], "spaces"),
      topic("direct", ["k3"], "sums"),
      topic("maps", ["k4"]),
    ],
    { prerequisites: [] },
  );
  expect(
    graph.nodes.map((node) => `${node.kind} ${node.id} in ${node.parentId}`),
  ).toEqual([
    "box box:spaces in null",
    "topic spaces in box:spaces",
    "topic bases in box:spaces",
    "box box:sums in box:spaces",
    "topic direct in box:sums",
    "topic maps in null",
  ]);
});

test("a Prerequisite between two Topics' KCs is one arrow; prior knowledge and links inside a Topic none", () => {
  const topics = [topic("t1", ["k1", "k2"]), topic("t2", ["k3"])];
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
    topic("t1", ["k1"]),
    topic("t2", ["k2"]),
    topic("t3", ["k3"]),
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
    topic("t1", ["k1"]),
    topic("t2", ["k2", "k4"]),
    topic("t3", ["k3", "k5"]),
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

test("ELK places cards inside nested boxes, with arrows across them", async () => {
  const graph = buildTopicGraph(
    [
      topic("spaces", ["k1"]),
      topic("sums", [], "spaces"),
      topic("direct", ["k2"], "sums"),
    ],
    { prerequisites: [prerequisite("k1", "k2")] },
  );
  const layouts = nodeLayouts(await new ELK().layout(toElkTopicGraph(graph)));
  expect(layouts.get("spaces")?.parentId).toBe(boxId("spaces"));
  expect(layouts.get(boxId("sums"))?.parentId).toBe(boxId("spaces"));
  expect(layouts.get("direct")?.parentId).toBe(boxId("sums"));
  expect(layouts.get("spaces")!.x).toBeLessThan(layouts.get(boxId("sums"))!.x);
});
