import type {
  MapGraphEdge,
  MapGraphNode,
} from "@/features/knowledge-map/domain/map-graph";

/**
 * What focusing a node highlights on the map graph (#118), over the edges
 * the graph shows.
 */

/**
 * How far focus reaches: the node's neighbours over any shown edge, or
 * everything before it (upstream), after it (downstream) or both, followed
 * transitively over shown Prerequisites and Exercises' edges.
 */
export type FocusDepth = "neighbours" | "upstream" | "downstream" | "both";

export const FOCUS_DEPTHS: FocusDepth[] = [
  "neighbours",
  "upstream",
  "downstream",
  "both",
];

export type Focus = { nodes: Set<string>; edges: Set<string> };

/** The edge kinds that point in learning order, which depth follows. */
const ORDERED: ReadonlySet<MapGraphEdge["kind"]> = new Set([
  "prerequisite",
  "tests",
]);

/**
 * The nodes and edges focusing `id` highlights, `id` included, given the
 * edges the graph shows. A Big idea focuses from all its KCs (`nodes` gives
 * their `parentId`). Hidden Prerequisites must be left out of `edges`:
 * focus never crosses an edge the Student can't see.
 */
export function focusOn(
  id: string,
  depth: FocusDepth,
  nodes: MapGraphNode[],
  edges: MapGraphEdge[],
): Focus {
  const seeds = [
    id,
    ...nodes
      .filter((node) => node.kind === "kc" && node.parentId === id)
      .map((node) => node.id),
  ];
  const focus: Focus = { nodes: new Set(seeds), edges: new Set() };
  if (depth === "neighbours") {
    for (const edge of edges) {
      if (focus.nodes.has(edge.source) || focus.nodes.has(edge.target)) {
        focus.edges.add(edge.id);
      }
    }
    for (const edge of edges) {
      if (focus.edges.has(edge.id)) {
        focus.nodes.add(edge.source);
        focus.nodes.add(edge.target);
      }
    }
    return focus;
  }
  const ordered = edges.filter((edge) => ORDERED.has(edge.kind));
  if (depth === "upstream" || depth === "both") {
    follow(seeds, ordered, "target", "source", focus);
  }
  if (depth === "downstream" || depth === "both") {
    follow(seeds, ordered, "source", "target", focus);
  }
  return focus;
}

/** Walks `edges` from `seeds`, from each edge's `from` end to its `to` end. */
function follow(
  seeds: string[],
  edges: MapGraphEdge[],
  from: "source" | "target",
  to: "source" | "target",
  focus: Focus,
) {
  const reached = new Set(seeds);
  const queue = [...seeds];
  for (
    let current = queue.pop();
    current !== undefined;
    current = queue.pop()
  ) {
    for (const edge of edges) {
      if (edge[from] !== current) continue;
      focus.edges.add(edge.id);
      focus.nodes.add(edge[to]);
      if (!reached.has(edge[to])) {
        reached.add(edge[to]);
        queue.push(edge[to]);
      }
    }
  }
}
