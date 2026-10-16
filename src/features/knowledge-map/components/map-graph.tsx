"use client";

import "@xyflow/react/dist/style.css";
import {
  Background,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import {
  BookmarkIcon,
  GitForkIcon,
  LibraryIcon,
  LightbulbIcon,
  ListOrderedIcon,
  type LucideIcon,
  PencilLineIcon,
} from "lucide-react";
import { useMemo } from "react";
import { Markdown } from "@/components/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  KcType,
  SemanticLinkType,
} from "@/features/knowledge-map/schemas";
import {
  DIFFICULTY_NAMES,
  TYPE_NAMES,
} from "@/features/knowledge-map/domain/kc-labels";
import {
  type Focus,
  type FocusDepth,
  focusOn,
} from "@/features/knowledge-map/domain/focus";
import {
  buildMapGraph,
  type MapGraphEdge,
  type MapGraphNode,
  type MapLayers,
  type NodeLayout,
  nodeLayouts,
  toElkGraph,
} from "@/features/knowledge-map/domain/map-graph";
import { useGraphLayout } from "@/features/knowledge-map/hooks/use-graph-layout";
import type {
  ExerciseView,
  KcView,
  KnowledgeMapView,
  MapKcLearning,
} from "@/features/knowledge-map/types";
import { cn } from "@/lib/utils";
import { SolutionBadge } from "./solution-badge";

const TYPE_ICONS: Record<KcType, LucideIcon> = {
  fact: BookmarkIcon,
  concept: LightbulbIcon,
  procedure: ListOrderedIcon,
  decision: GitForkIcon,
  prior: LibraryIcon,
};

type KcState = MapKcLearning[string]["state"];

const STATE_MARKERS: Record<KcState, { name: string; className: string }> = {
  new: {
    name: "New",
    className: "border border-muted-foreground bg-transparent",
  },
  learning: { name: "Learning", className: "bg-brand" },
  due: { name: "Due", className: "bg-warning" },
  mastered: { name: "Mastered", className: "bg-success" },
};

/**
 * Each Semantic link type's colour, readable on both themes' canvas; "other"
 * stays neutral.
 */
export const SEMANTIC_LINK_COLORS: Record<SemanticLinkType, string> = {
  is_a: "oklch(0.6 0.16 265)",
  part_of: "oklch(0.62 0.13 200)",
  contrasts_with: "oklch(0.6 0.19 27)",
  causes: "oklch(0.68 0.15 75)",
  special_case_of: "oklch(0.6 0.17 320)",
  applies_in: "oklch(0.6 0.14 150)",
  other: "var(--muted-foreground)",
};

/**
 * `related`: highlighted by the focus, or by a check-report item, without
 * being the selected node.
 */
type KcNodeData = {
  kc: KcView;
  state: KcState;
  selected: boolean;
  related: boolean;
};
type BigIdeaNodeData = { name: string; selected: boolean };
type ExerciseNodeData = {
  exercise: ExerciseView;
  selected: boolean;
  related: boolean;
  badge: boolean;
};
type KcNode = Node<KcNodeData, "kc">;
type BigIdeaNode = Node<BigIdeaNodeData, "bigIdea">;
type ExerciseNode = Node<ExerciseNodeData, "exercise">;

/** The invisible ends edges attach to. */
function Handles({ source = true }: { source?: boolean }) {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="opacity-0"
      />
      {source && (
        <Handle
          type="source"
          position={Position.Right}
          isConnectable={false}
          className="opacity-0"
        />
      )}
    </>
  );
}

/** A KC: its type icon, name and state marker. */
function KcNodeView({ data }: NodeProps<KcNode>) {
  const { kc, state, selected, related } = data;
  const Icon = TYPE_ICONS[kc.type];
  const marker = STATE_MARKERS[state];
  return (
    <>
      <Handles />
      <button
        type="button"
        aria-label={kc.name}
        aria-pressed={selected}
        className={cn(
          "flex size-full items-start gap-2 rounded-lg border bg-card px-3 py-2 text-left text-sm shadow-xs transition-colors hover:border-ring",
          related && "border-brand",
          selected && "border-brand ring-2 ring-brand/40",
        )}
      >
        <Icon
          aria-label={TYPE_NAMES[kc.type]}
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <span className="line-clamp-3 min-w-0 flex-1 font-medium">
          <Markdown>{kc.name}</Markdown>
        </span>
        <span
          title={marker.name}
          aria-label={`State: ${marker.name}`}
          className={cn(
            "mt-1 size-2.5 shrink-0 rounded-full",
            marker.className,
          )}
        />
      </button>
    </>
  );
}

/** An Exercise: its name, difficulty and, if shown, its solution status. */
function ExerciseNodeView({ data }: NodeProps<ExerciseNode>) {
  const { exercise, selected, related, badge } = data;
  return (
    <>
      <Handles source={false} />
      <button
        type="button"
        aria-label={exercise.name}
        aria-pressed={selected}
        className={cn(
          "flex size-full flex-col justify-between gap-1 rounded-md border border-dashed bg-card px-3 py-1.5 text-left text-xs shadow-xs transition-colors hover:border-ring",
          related && "border-brand",
          selected && "border-solid border-brand ring-2 ring-brand/40",
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <PencilLineIcon
            aria-label="Exercise"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="truncate font-medium">
            <Markdown>{exercise.name}</Markdown>
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {DIFFICULTY_NAMES[exercise.difficulty]}
          {badge && <SolutionBadge status={exercise.solutionStatus} />}
        </span>
      </button>
    </>
  );
}

/** A Big idea: a box around its KCs, with its name on top. */
function BigIdeaNodeView({ data }: NodeProps<BigIdeaNode>) {
  return (
    <div
      className={cn(
        "size-full rounded-xl border border-dashed bg-muted/40",
        data.selected && "border-brand",
      )}
    >
      <button
        type="button"
        aria-pressed={data.selected}
        className="w-full truncate px-4 py-2.5 text-left text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <Markdown>{data.name}</Markdown>
      </button>
    </div>
  );
}

const nodeTypes = {
  kc: KcNodeView,
  bigIdea: BigIdeaNodeView,
  exercise: ExerciseNodeView,
};

const EDGE_STYLES = {
  tests: { strokeDasharray: "2 4" },
} as const;

/**
 * How React Flow draws each kind of edge: thicker when `focus` highlights
 * it, faded when a focus leaves it out.
 */
function flowEdge(edge: MapGraphEdge, focus: Focus | null): Edge {
  const focused = focus?.edges.has(edge.id) ?? false;
  const common = {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    focusable: false,
    ...(focus && !focused && { className: "opacity-15" }),
  };
  const width = focused ? { strokeWidth: 2 } : {};
  switch (edge.kind) {
    case "prerequisite":
      return {
        ...common,
        style: width,
        markerEnd: { type: MarkerType.ArrowClosed },
      };
    case "tests":
      return { ...common, style: { ...EDGE_STYLES.tests, ...width } };
    case "semantic": {
      const color = SEMANTIC_LINK_COLORS[edge.coreType];
      return {
        ...common,
        label: edge.label,
        style: { stroke: color, strokeDasharray: "6 4", ...width },
        labelStyle: { fill: color, fontSize: 11 },
        labelBgStyle: { fill: "var(--background)" },
        markerEnd: { type: MarkerType.Arrow, color },
      };
    }
  }
}

/**
 * The Knowledge map as a graph laid out left to right in learning order,
 * with the layers `layers` switches on: each Big idea a box of its KCs,
 * prior knowledge leftmost, Exercises right of the KCs they test,
 * Prerequisites as arrows and Semantic links dashed. A skeleton shows until
 * the first layout. Clicking a KC, Exercise or Big idea calls `onSelect`
 * with its id, and clicking the empty canvas calls `onClear`.
 *
 * The selected node is focused: what `depth` reaches from it over the shown
 * edges is highlighted and the rest fades. Without a selection, the nodes in
 * `highlighted` (a check-report item's KCs) are highlighted instead.
 */
export function MapGraph({
  map,
  learning,
  layers,
  selectedId,
  depth,
  highlighted,
  onSelect,
  onClear,
}: {
  map: KnowledgeMapView;
  learning: MapKcLearning;
  layers: MapLayers;
  selectedId: string | null;
  depth: FocusDepth;
  highlighted: Set<string> | null;
  onSelect: (id: string) => void;
  onClear: () => void;
}) {
  const graph = useMemo(() => buildMapGraph(map, layers), [map, layers]);
  const elkGraph = useMemo(() => toElkGraph(graph), [graph]);
  const laidOut = useGraphLayout(elkGraph);

  const { nodes, edges } = useMemo(() => {
    const layouts = laidOut ? nodeLayouts(laidOut) : new Map<string, never>();
    const kcs = new Map(
      [...map.bigIdeas.flatMap((b) => b.kcs), ...map.priorKnowledge].map(
        (kc) => [kc.id, kc],
      ),
    );
    const exercises = new Map(map.exercises.map((e) => [e.id, e]));
    const bigIdeaName = new Map(map.bigIdeas.map((b) => [b.id, b.name]));
    const placed: Array<{ node: MapGraphNode; layout: NodeLayout }> = [];
    const shown = new Set<string>();
    for (const node of graph.nodes) {
      const layout = layouts.get(node.id);
      const parentId = node.kind === "kc" ? node.parentId : null;
      // A node the last layout hasn't placed, or placed in another group,
      // waits for the next one.
      if (!layout || layout.parentId !== parentId) continue;
      if (parentId !== null && !shown.has(parentId)) continue;
      placed.push({ node, layout });
      shown.add(node.id);
    }
    const visible = graph.edges.filter(
      (edge) =>
        !(edge.kind === "prerequisite" && edge.hidden) &&
        shown.has(edge.source) &&
        shown.has(edge.target),
    );
    const focus: Focus | null =
      selectedId !== null && shown.has(selectedId)
        ? focusOn(
            selectedId,
            depth,
            placed.map((p) => p.node),
            visible,
          )
        : highlighted && { nodes: highlighted, edges: new Set() };
    // A Big idea's box stays clear while any of its KCs is in focus.
    const inFocus = (node: MapGraphNode) =>
      !focus ||
      focus.nodes.has(node.id) ||
      (node.kind === "bigIdea" &&
        placed.some(
          (p) =>
            p.node.kind === "kc" &&
            p.node.parentId === node.id &&
            focus.nodes.has(p.node.id),
        ));

    const nodes = placed.map(
      ({ node, layout }): KcNode | BigIdeaNode | ExerciseNode => {
        const common = {
          id: node.id,
          position: { x: layout.x, y: layout.y },
          width: layout.width,
          height: layout.height,
          focusable: false,
          className: cn("transition-opacity", !inFocus(node) && "opacity-30"),
        };
        const selected = node.id === selectedId;
        const related = !selected && focus !== null && focus.nodes.has(node.id);
        if (node.kind === "bigIdea") {
          return {
            ...common,
            type: "bigIdea",
            data: { name: bigIdeaName.get(node.id) ?? "", selected },
          };
        }
        if (node.kind === "exercise") {
          return {
            ...common,
            type: "exercise",
            data: {
              exercise: exercises.get(node.id)!,
              selected,
              related,
              badge: layers.solutionBadges,
            },
          };
        }
        return {
          ...common,
          type: "kc",
          ...(node.parentId !== null && { parentId: node.parentId }),
          data: {
            kc: kcs.get(node.id)!,
            state: learning[node.id]?.state ?? "new",
            selected,
            related,
          },
        };
      },
    );
    const edges = visible.map((edge) => flowEdge(edge, focus));
    return { nodes, edges };
  }, [graph, laidOut, map, learning, layers, selectedId, depth, highlighted]);

  if (!laidOut) {
    return (
      <Skeleton
        aria-label="Laying out the map"
        className="size-full min-h-96 rounded-xl"
      />
    );
  }
  return (
    <ReactFlow
      aria-label="Knowledge map graph"
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={onClear}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      fitView
      minZoom={0.1}
      className="rounded-xl border"
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
