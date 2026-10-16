import type {
  MapGraphEdge,
  MapGraphNode,
} from "@/features/knowledge-map/domain/map-graph";
import type { CheckReportView } from "@/features/knowledge-map/types";

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

/** A check-report item that names KCs, which highlights them on the graph. */
export type CheckItem = {
  key: string;
  /** Markdown, as the report shows it. */
  text: string;
  kcNames: string[];
};

/**
 * The check report's items that name KCs, in report order: KCs without a
 * source or links, Prerequisites dropped to break cycles, KCs no Exercise
 * tests and possible duplicates.
 */
export function checkItems(report: CheckReportView): CheckItem[] {
  const items: CheckItem[] = [
    {
      key: "ungrounded",
      text: `KCs without a source: ${report.ungroundedKcs.join(", ")}`,
      kcNames: report.ungroundedKcs,
    },
    {
      key: "orphan",
      text: `KCs without links: ${report.orphanKcs.join(", ")}`,
      kcNames: report.orphanKcs,
    },
    {
      key: "cycles",
      text: `Prerequisites dropped to break cycles: ${report.droppedCycleEdges
        .map((edge) => `${edge.from} → ${edge.to}`)
        .join(", ")}`,
      kcNames: report.droppedCycleEdges.flatMap((edge) => [edge.from, edge.to]),
    },
    {
      key: "untested",
      text: `KCs no exercise tests: ${report.untestedKcs.join(", ")}`,
      kcNames: report.untestedKcs,
    },
    {
      key: "duplicates",
      text: `Possible duplicate KCs: ${report.duplicates
        .map((pair) => `${pair.a} and ${pair.b}`)
        .join("; ")}`,
      kcNames: report.duplicates.flatMap((pair) => [pair.a, pair.b]),
    },
  ];
  return items.filter((item) => item.kcNames.length > 0);
}

/**
 * The ids of the KCs named in `names`, by exact name: the report lists KCs
 * by name, so every KC that shares one is matched.
 */
export function kcIdsNamed(
  kcs: Array<{ id: string; name: string }>,
  names: string[],
): Set<string> {
  const wanted = new Set(names);
  return new Set(kcs.filter((kc) => wanted.has(kc.name)).map((kc) => kc.id));
}
