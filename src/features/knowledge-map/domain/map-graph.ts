import type { ElkNode } from "elkjs/lib/elk-api";
import type { KnowledgeMapView } from "@/features/knowledge-map/types";

/**
 * The Knowledge map as a graph (#118): each Big idea a group holding its KCs,
 * prior knowledge outside the groups, and Prerequisites as edges. Pure code:
 * the map page lays the graph out with ELK and draws it with React Flow.
 */

/** A KC node's size; the node clamps longer names. */
export const KC_NODE_SIZE = { width: 224, height: 72 } as const;

/** Room around a group's KCs, with its name on top. */
const GROUP_PADDING = "[top=44,left=16,bottom=16,right=16]";

export type MapGraphNode =
  | { id: string; kind: "bigIdea" }
  /** `parentId`: the id of its Big idea's group; null for prior knowledge. */
  | { id: string; kind: "kc"; parentId: string | null };

/** `source` must be learned before `target`. */
export type MapGraphEdge = {
  id: string;
  kind: "prerequisite";
  source: string;
  target: string;
};

export type MapGraph = { nodes: MapGraphNode[]; edges: MapGraphEdge[] };

/**
 * The map's graph: Big ideas with KCs as groups, each followed by its KCs,
 * then prior knowledge, and the Prerequisites between them, all in map
 * order. Node ids are the rows' ids.
 */
export function buildMapGraph(map: KnowledgeMapView): MapGraph {
  const nodes: MapGraphNode[] = [];
  for (const bigIdea of map.bigIdeas) {
    if (bigIdea.kcs.length === 0) continue;
    nodes.push({ id: bigIdea.id, kind: "bigIdea" });
    for (const kc of bigIdea.kcs) {
      nodes.push({ id: kc.id, kind: "kc", parentId: bigIdea.id });
    }
  }
  for (const kc of map.priorKnowledge) {
    nodes.push({ id: kc.id, kind: "kc", parentId: null });
  }
  const ids = new Set(nodes.map((node) => node.id));
  const edges = map.prerequisites
    .filter((link) => ids.has(link.from) && ids.has(link.to))
    .map((link): MapGraphEdge => ({
      id: `prerequisite:${link.from}:${link.to}`,
      kind: "prerequisite",
      source: link.from,
      target: link.to,
    }));
  return { nodes, edges };
}

/**
 * The graph as ELK lays it out: layered, left to right in learning order,
 * with edges between groups' KCs laid out across groups
 * (`INCLUDE_CHILDREN`) and prior knowledge in a first layer of its own,
 * linked or not. Its value
 * changes only when nodes or edges do, so it keys the layout.
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
    } else if (node.parentId === null) {
      children.push({
        ...kc(node.id),
        // FIRST alone leaves unlinked nodes where layering puts them.
        layoutOptions: {
          "elk.layered.layering.layerConstraint": "FIRST_SEPARATE",
        },
      });
    }
  }
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      // One layering for the whole map, so prior knowledge stays leftmost.
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

/** Where a node goes: relative to its group, or to the canvas without one. */
export type NodeLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
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
      });
      visit(child);
    }
  };
  visit(laidOut);
  return layouts;
}
