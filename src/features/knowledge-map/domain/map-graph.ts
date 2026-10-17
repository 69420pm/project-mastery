import type { ElkNode } from "elkjs/lib/elk-api";
import {
  SEMANTIC_LINK_TYPES,
  type SemanticLinkType,
} from "@/features/knowledge-map/schemas";
import type { KnowledgeMapView } from "@/features/knowledge-map/types";

/**
 * The Knowledge map as a graph (#118): each Big idea a group holding its KCs,
 * prior knowledge outside the groups, Exercises beside the KCs they test,
 * and Prerequisites and Semantic links as edges, as the layer toggles pick.
 * Pure code: the map page lays the graph out with ELK and draws it with
 * React Flow.
 */

/** A KC node's size; the node clamps longer names. */
export const KC_NODE_SIZE = { width: 224, height: 72 } as const;

/** An Exercise node's size; the node clamps longer names. */
export const EXERCISE_NODE_SIZE = { width: 200, height: 64 } as const;

/** Room around a group's KCs, with its name on top. */
const GROUP_PADDING = "[top=44,left=16,bottom=16,right=16]";

/** What the graph shows; each toggle switches a layer on or off. */
export type MapLayers = {
  priorKnowledge: boolean;
  exercises: boolean;
  solutionBadges: boolean;
  prerequisites: boolean;
  semanticLinks: Record<SemanticLinkType, boolean>;
  /** Off lays the KCs out flat, without their Big ideas' boxes. */
  bigIdeaGroups: boolean;
};

export const DEFAULT_LAYERS: MapLayers = {
  priorKnowledge: true,
  exercises: true,
  solutionBadges: true,
  prerequisites: true,
  semanticLinks: Object.fromEntries(
    SEMANTIC_LINK_TYPES.map((type) => [type, true]),
  ) as Record<SemanticLinkType, boolean>,
  bigIdeaGroups: true,
};

export type MapGraphNode =
  | { id: string; kind: "bigIdea" }
  /**
   * `parentId`: the id of its Big idea's group; null for prior knowledge, or
   * for every KC without groups.
   */
  | { id: string; kind: "kc"; parentId: string | null; prior: boolean }
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
  | { id: string; kind: "tests"; source: string; target: string }
  /** Left out of the layout. */
  | {
      id: string;
      kind: "semantic";
      source: string;
      target: string;
      coreType: SemanticLinkType;
      label: string;
    };

export type MapGraph = { nodes: MapGraphNode[]; edges: MapGraphEdge[] };

/**
 * The map's graph per `layers`: Big ideas with KCs as groups, each followed
 * by its KCs, then prior knowledge, then Exercises, and the edges between
 * the nodes it has, all in map order. Node ids are the rows' ids.
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
        prior: false,
      });
    }
  }
  if (layers.priorKnowledge) {
    for (const kc of map.priorKnowledge) {
      nodes.push({ id: kc.id, kind: "kc", parentId: null, prior: true });
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
  const linked = (link: { from: string; to: string }) =>
    ids.has(link.from) && ids.has(link.to);
  const prerequisites = map.prerequisites
    .filter(linked)
    .map((link): MapGraphEdge => ({
      id: `prerequisite:${link.from}:${link.to}`,
      kind: "prerequisite",
      source: link.from,
      target: link.to,
      hidden: !layers.prerequisites,
    }));
  const semantic = map.semanticLinks
    .filter((link) => linked(link) && layers.semanticLinks[link.coreType])
    .map((link, index): MapGraphEdge => ({
      id: `semantic:${index}:${link.from}:${link.to}`,
      kind: "semantic",
      source: link.from,
      target: link.to,
      coreType: link.coreType,
      label: link.label,
    }));
  return { nodes, edges: [...prerequisites, ...tests, ...semantic] };
}

/**
 * The graph as ELK lays it out: layered, left to right in learning order,
 * with edges between groups' KCs laid out across groups
 * (`INCLUDE_CHILDREN`) and prior knowledge in a first layer of its own,
 * linked or not. Prerequisites, hidden or not, and Exercises' edges drive
 * it; Semantic links don't. Its value changes only when nodes or those
 * edges do, so it keys the layout.
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
      children.push({
        ...kc(node.id),
        ...(node.prior && {
          // FIRST alone leaves unlinked nodes where layering puts them.
          layoutOptions: {
            "elk.layered.layering.layerConstraint": "FIRST_SEPARATE",
          },
        }),
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
    edges: graph.edges
      .filter((edge) => edge.kind !== "semantic")
      .map((edge) => ({
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
