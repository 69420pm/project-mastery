import type { ElkNode } from "elkjs/lib/elk-api";
import type { KnowledgeMapView } from "@/features/knowledge-map/types";

/**
 * The Knowledge map as a graph (#118): each Big idea a group holding its KCs,
 * Exercises beside the KCs they test, and Prerequisites as edges, as the
 * layer toggles pick. Pure code: the map page lays the graph out with ELK and
 * draws it with React Flow.
 */

/** A KC node's size; the node clamps longer names. */
const KC_NODE_SIZE = { width: 224, height: 72 } as const;

/** An Exercise node's size; the node clamps longer names. */
const EXERCISE_NODE_SIZE = { width: 200, height: 64 } as const;

/** Room around a group's KCs, with its name on top. */
const GROUP_PADDING = "[top=44,left=16,bottom=16,right=16]";

/** What the graph shows; each toggle switches a layer on or off. */
export type MapLayers = {
  exercises: boolean;
  prerequisites: boolean;
  /** Off lays the KCs out flat, without their Big ideas' boxes. */
  bigIdeaGroups: boolean;
};

export const DEFAULT_LAYERS: MapLayers = {
  exercises: true,
  prerequisites: true,
  bigIdeaGroups: true,
};

export type MapGraphNode =
  | { id: string; kind: "bigIdea" }
  /**
   * `parentId`: the id of its Big idea's group; null for every KC without
   * groups.
   */
  | { id: string; kind: "kc"; parentId: string | null }
  | { id: string; kind: "exercise" };

export type MapGraphEdge =
  /**
   * `source` must be learned before `target`. Hidden ones still drive the
   * layout.
   */
  | {
      id: string;
      kind: "prerequisite";
      source: string;
      target: string;
      hidden: boolean;
    }
  /** Exercise `target` tests KC `source`, so it sits to the KC's right. */
  | { id: string; kind: "tests"; source: string; target: string };

export type MapGraph = { nodes: MapGraphNode[]; edges: MapGraphEdge[] };

/**
 * The map's graph per `layers`: Big ideas with KCs as groups, each followed
 * by its KCs, then Exercises, and the edges between the nodes it has, all in
 * map order. Node ids are the rows' ids.
 */
export function buildMapGraph(
  map: KnowledgeMapView,
  layers: MapLayers = DEFAULT_LAYERS,
): MapGraph {
  const nodes: MapGraphNode[] = [];
  for (const bigIdea of map.bigIdeas) {
    if (bigIdea.kcs.length === 0) continue;
    if (layers.bigIdeaGroups) nodes.push({ id: bigIdea.id, kind: "bigIdea" });
    for (const kc of bigIdea.kcs) {
      nodes.push({
        id: kc.id,
        kind: "kc",
        parentId: layers.bigIdeaGroups ? bigIdea.id : null,
      });
    }
  }
  const ids = new Set(nodes.map((node) => node.id));
  const tests: MapGraphEdge[] = [];
  if (layers.exercises) {
    for (const exercise of map.exercises) {
      nodes.push({ id: exercise.id, kind: "exercise" });
      for (const kcId of exercise.kcs.filter((id) => ids.has(id))) {
        tests.push({
          id: `tests:${exercise.id}:${kcId}`,
          kind: "tests",
          source: kcId,
          target: exercise.id,
        });
      }
    }
  }
  const prerequisites = map.prerequisites
    .filter((link) => ids.has(link.from) && ids.has(link.to))
    .map((link): MapGraphEdge => ({
      id: `prerequisite:${link.from}:${link.to}`,
      kind: "prerequisite",
      source: link.from,
      target: link.to,
      hidden: !layers.prerequisites,
    }));
  return { nodes, edges: [...prerequisites, ...tests] };
}

/**
 * The graph as ELK lays it out: layered, left to right in learning order,
 * with edges between groups' KCs laid out across groups
 * (`INCLUDE_CHILDREN`). Prerequisites, hidden or not, and Exercises' edges
 * drive it. Its value changes only when nodes or edges do, so it keys the
 * layout.
 */
export function toElkGraph(graph: MapGraph): ElkNode {
  const kc = (id: string): ElkNode => ({ id, ...KC_NODE_SIZE });
  const children: ElkNode[] = [];
  for (const node of graph.nodes) {
    if (node.kind === "bigIdea") {
      children.push({
        id: node.id,
        layoutOptions: { "elk.padding": GROUP_PADDING },
        children: graph.nodes
          .filter((child) => child.kind === "kc" && child.parentId === node.id)
          .map((child) => kc(child.id)),
      });
    } else if (node.kind === "exercise") {
      children.push({ id: node.id, ...EXERCISE_NODE_SIZE });
    } else if (node.parentId === null) {
      children.push(kc(node.id));
    }
  }
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      // One layering for the whole map.
      "elk.separateConnectedComponents": "false",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.spacing.nodeNode": "24",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.spacing.componentComponent": "48",
    },
    children,
    // Edges may sit on the root: ELK moves each into its lowest common
    // ancestor (`container`).
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };
}

/**
 * Where a node goes: relative to its group `parentId`, or to the canvas
 * without one (null).
 */
export type NodeLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
};

/** Each laid-out node's place and size by id, from ELK's result. */
export function nodeLayouts(laidOut: ElkNode): Map<string, NodeLayout> {
  const layouts = new Map<string, NodeLayout>();
  const visit = (node: ElkNode) => {
    for (const child of node.children ?? []) {
      layouts.set(child.id, {
        x: child.x ?? 0,
        y: child.y ?? 0,
        width: child.width ?? 0,
        height: child.height ?? 0,
        parentId: node === laidOut ? null : node.id,
      });
      visit(child);
    }
  };
  visit(laidOut);
  return layouts;
}
