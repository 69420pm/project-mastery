import type { ElkNode } from "elkjs/lib/elk-api";
import type {
  KnowledgeMapView,
  MapTopic,
} from "@/features/knowledge-map/types";

/**
 * The Course map as a graph (#176, #229): the Topic tree as nested boxes,
 * each Topic with child Topics a box holding them and, when it has KCs of
 * its own, its own card beside them; and an arrow from Topic A to Topic B
 * when a KC of A is a Prerequisite of a KC of B, reduced to the arrows no
 * other path implies. Pure code: the Course map lays it out with ELK and
 * draws it with React Flow, as the KC graph is (ADR 0017).
 */

/** A Topic card's size; the card clamps longer text. */
const TOPIC_NODE_SIZE = { width: 256, height: 148 } as const;

/** Room around a box's Topics, with its name on top. */
const BOX_PADDING = "[top=44,left=16,bottom=16,right=16]";

/** The id of the box of a Topic with child Topics. */
export const boxId = (topicId: string) => `box:${topicId}`;

export type TopicGraphNode =
  /** `parentId`: the box it sits in; null at the top. */
  | { id: string; kind: "box"; parentId: string | null; topic: MapTopic }
  /** The card of a Topic's own KCs; its id is the Topic's. */
  | { id: string; kind: "topic"; parentId: string | null; topic: MapTopic };

/** Topic `source` holds a Prerequisite of a KC in Topic `target`. */
export type TopicGraphEdge = { id: string; source: string; target: string };

export type TopicGraph = { nodes: TopicGraphNode[]; edges: TopicGraphEdge[] };

/**
 * The Topic tree as a graph in tree order: a Topic with children becomes a
 * box, followed by its own card when it has KCs of its own and then its
 * children; any other Topic a card. Arrows run between cards. A KC no
 * Topic holds adds no arrow.
 */
export function buildTopicGraph(
  topics: MapTopic[],
  map: Pick<KnowledgeMapView, "prerequisites">,
): TopicGraph {
  const parents = new Set(topics.flatMap((topic) => topic.parentId ?? []));
  const nodes: TopicGraphNode[] = [];
  for (const topic of topics) {
    const parentId = topic.parentId === null ? null : boxId(topic.parentId);
    if (!parents.has(topic.id)) {
      nodes.push({ id: topic.id, kind: "topic", parentId, topic });
      continue;
    }
    nodes.push({ id: boxId(topic.id), kind: "box", parentId, topic });
    if (topic.kcs.length > 0) {
      nodes.push({
        id: topic.id,
        kind: "topic",
        parentId: boxId(topic.id),
        topic,
      });
    }
  }
  return { nodes, edges: reducedArrows(topics, map.prerequisites) };
}

/**
 * The Topic arrows the Prerequisites imply, in Course order, without those
 * another path between the Topics implies. Arrows on a cycle all stay; the
 * reduction runs on the cycles' condensation, so an arrow into or out of a
 * cycle stays unless a path around the cycle implies it.
 */
function reducedArrows(
  topics: MapTopic[],
  prerequisites: Array<{ from: string; to: string }>,
): TopicGraphEdge[] {
  const topicOf = new Map(
    topics.flatMap((topic) => topic.kcs.map((kc) => [kc.id, topic.id])),
  );
  const order = new Map(topics.map((topic, index) => [topic.id, index]));
  const successors = new Map(topics.map((t) => [t.id, new Set<string>()]));
  for (const { from, to } of prerequisites) {
    const source = topicOf.get(from);
    const target = topicOf.get(to);
    if (source && target && source !== target) {
      successors.get(source)!.add(target);
    }
  }

  const reach = new Map(
    topics.map((topic) => [topic.id, reachable(topic.id, successors)]),
  );
  // Each Topic's cycle (strongly connected component) by its first Topic.
  const cycleOf = new Map(
    topics.map((topic) => [
      topic.id,
      topics.find(
        (other) =>
          other.id === topic.id ||
          (reach.get(topic.id)!.has(other.id) &&
            reach.get(other.id)!.has(topic.id)),
      )!.id,
    ]),
  );
  const condensed = new Map<string, Set<string>>();
  for (const [source, targets] of successors) {
    for (const target of targets) {
      const from = cycleOf.get(source)!;
      const to = cycleOf.get(target)!;
      if (from === to) continue;
      if (!condensed.has(from)) condensed.set(from, new Set());
      condensed.get(from)!.add(to);
    }
  }
  const implied = (from: string, to: string) =>
    [...(condensed.get(from) ?? [])].some(
      (via) => via !== to && reachable(via, condensed).has(to),
    );

  const edges: TopicGraphEdge[] = [];
  for (const [source, targets] of successors) {
    const sorted = [...targets].sort((a, b) => order.get(a)! - order.get(b)!);
    for (const target of sorted) {
      const from = cycleOf.get(source)!;
      const to = cycleOf.get(target)!;
      if (from !== to && implied(from, to)) continue;
      edges.push({ id: `topic:${source}:${target}`, source, target });
    }
  }
  return edges;
}

/** The ids reachable from `start` over at least one edge. */
function reachable(
  start: string,
  successors: Map<string, Set<string>>,
): Set<string> {
  const seen = new Set<string>();
  const stack = [...(successors.get(start) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(successors.get(id) ?? []));
  }
  return seen;
}

/**
 * The graph as ELK lays it out: layered, left to right in learning order,
 * boxes nested to any depth, with arrows between boxes' Topics laid out
 * across boxes (`INCLUDE_CHILDREN`). Its value changes only when nodes or
 * arrows do, so it keys the layout.
 */
export function toElkTopicGraph(graph: TopicGraph): ElkNode {
  const childrenOf = (parentId: string | null): ElkNode[] =>
    graph.nodes
      .filter((node) => node.parentId === parentId)
      .map((node) =>
        node.kind === "box"
          ? {
              id: node.id,
              layoutOptions: { "elk.padding": BOX_PADDING },
              children: childrenOf(node.id),
            }
          : { id: node.id, ...TOPIC_NODE_SIZE },
      );
  const children = childrenOf(null);
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.spacing.nodeNode": "24",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.spacing.componentComponent": "48",
    },
    children,
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };
}
