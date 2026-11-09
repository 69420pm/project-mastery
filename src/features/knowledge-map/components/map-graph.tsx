"use client";

import "@xyflow/react/dist/style.css";
import {
  Background,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import { CopyIcon, type LucideIcon, PencilLineIcon } from "lucide-react";
import { useMemo } from "react";
import { Markdown } from "@/components/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type ColorBy,
  kcColor,
  priorityFractions,
  sizeScale,
} from "@/features/knowledge-map/domain/encodings";
import {
  BAND_NAMES,
  type CheckBadgeKind,
  checkBadges,
  DIFFICULTY_NAMES,
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
  MapPriorities,
  MapRecallBand,
} from "@/features/knowledge-map/types";
import { cn } from "@/lib/utils";
import { ZoomControls } from "./zoom-controls";

const BADGE_ICONS: Record<CheckBadgeKind, LucideIcon> = {
  duplicate: CopyIcon,
};

const BAND_MARKERS: Record<MapRecallBand, string> = {
  new: "border border-muted-foreground bg-transparent",
  weak: "bg-destructive",
  fading: "bg-warning",
  strong: "bg-success",
};

/**
 * `related`: highlighted by the focus without being the selected node.
 */
type KcNodeData = {
  kc: KcView;
  band: MapRecallBand;
  selected: boolean;
  related: boolean;
  /** The colour-by encoding's colour. */
  color: string;
  /** The factor the visual shrinks by; the layout box stays fixed. */
  scale: number;
  badges: Array<{ kind: CheckBadgeKind; label: string }>;
};
type ExerciseNodeData = {
  exercise: ExerciseView;
  selected: boolean;
  related: boolean;
};
type KcNode = Node<KcNodeData, "kc">;
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

/** A KC: its name and recall band marker. */
function KcNodeView({ data }: NodeProps<KcNode>) {
  const { kc, band, selected, related, color, scale, badges } = data;
  return (
    <>
      <Handles />
      <button
        type="button"
        aria-label={kc.name}
        aria-pressed={selected}
        style={{
          borderLeftColor: color,
          backgroundColor: `color-mix(in oklch, ${color} 12%, var(--card))`,
          ...(scale !== 1 && { transform: `scale(${scale})` }),
        }}
        className={cn(
          "relative flex size-full items-start gap-2 rounded-lg border border-l-4 bg-card px-3 py-2 text-left text-sm shadow-xs transition-colors hover:border-ring",
          related && "border-brand",
          selected && "border-brand ring-2 ring-brand/40",
        )}
      >
        {badges.length > 0 && (
          <span className="absolute -top-2 right-2 flex gap-1">
            {badges.map((badge) => {
              const BadgeIcon = BADGE_ICONS[badge.kind];
              return (
                <span
                  key={badge.label}
                  title={badge.label}
                  role="img"
                  aria-label={badge.label}
                  className="flex size-5 items-center justify-center rounded-full border bg-warning text-warning-foreground"
                >
                  <BadgeIcon className="size-3" />
                </span>
              );
            })}
          </span>
        )}
        <span className="line-clamp-3 min-w-0 flex-1 font-medium">
          <Markdown>{kc.name}</Markdown>
        </span>
        <span
          title={BAND_NAMES[band]}
          aria-label={`Recall: ${BAND_NAMES[band]}`}
          className={cn(
            "mt-1 size-2.5 shrink-0 rounded-full",
            BAND_MARKERS[band],
          )}
        />
      </button>
    </>
  );
}

/** An Exercise: its label and difficulty. */
function ExerciseNodeView({ data }: NodeProps<ExerciseNode>) {
  const { exercise, selected, related } = data;
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
        <span className="text-muted-foreground">
          {DIFFICULTY_NAMES[exercise.difficulty]}
        </span>
      </button>
    </>
  );
}

const nodeTypes = {
  kc: KcNodeView,
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
  }
}

/**
 * The Knowledge map as a graph laid out left to right in learning order,
 * with the layers `layers` switches on: its KCs, Exercises right of the
 * KCs they test and Prerequisites as arrows. A skeleton shows until the
 * first layout. Clicking a KC or Exercise calls `onSelect`
 * with its id, and clicking the empty canvas calls `onClear`.
 *
 * The selected node is focused: what `depth` reaches from it over the shown
 * edges is highlighted and the rest fades.
 */
export function MapGraph({
  map,
  learning,
  priorities,
  layers,
  colorBy,
  sizeByPriority,
  selectedId,
  depth,
  onSelect,
  onClear,
}: {
  map: KnowledgeMapView;
  learning: MapKcLearning;
  priorities: MapPriorities;
  layers: MapLayers;
  colorBy: ColorBy;
  sizeByPriority: boolean;
  selectedId: string | null;
  depth: FocusDepth;
  onSelect: (id: string) => void;
  onClear: () => void;
}) {
  const graph = useMemo(() => buildMapGraph(map, layers), [map, layers]);
  const elkGraph = useMemo(() => toElkGraph(graph), [graph]);
  const { laidOut, failed } = useGraphLayout(elkGraph);

  const { nodes, edges } = useMemo(() => {
    const layouts = laidOut ? nodeLayouts(laidOut) : new Map<string, never>();
    const kcs = new Map(map.kcs.map((kc) => [kc.id, kc]));
    const exercises = new Map(map.exercises.map((e) => [e.id, e]));
    const fractions = priorityFractions(priorities.kcs);
    const placed: Array<{ node: MapGraphNode; layout: NodeLayout }> = [];
    const shown = new Set<string>();
    for (const node of graph.nodes) {
      const layout = layouts.get(node.id);
      // A node the last layout hasn't placed waits for the next one.
      if (!layout) continue;
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
        ? focusOn(selectedId, depth, visible)
        : null;
    const inFocus = (node: MapGraphNode) => !focus || focus.nodes.has(node.id);

    const nodes = placed.map(({ node, layout }): KcNode | ExerciseNode => {
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
      if (node.kind === "exercise") {
        return {
          ...common,
          type: "exercise",
          data: {
            exercise: exercises.get(node.id)!,
            selected,
            related,
          },
        };
      }
      const kc = kcs.get(node.id)!;
      const band = learning[node.id]?.band ?? "new";
      const fraction = fractions.get(node.id);
      return {
        ...common,
        type: "kc",
        data: {
          kc,
          band,
          selected,
          related,
          color: kcColor(colorBy, { band, fraction }),
          scale: sizeByPriority && fractions.size > 0 ? sizeScale(fraction) : 1,
          badges: checkBadges(map.checkReport, kc.name),
        },
      };
    });
    const edges = visible.map((edge) => flowEdge(edge, focus));
    return { nodes, edges };
  }, [
    graph,
    laidOut,
    map,
    learning,
    priorities,
    colorBy,
    sizeByPriority,
    selectedId,
    depth,
  ]);

  if (failed) {
    return (
      <p
        role="alert"
        className="flex size-full min-h-96 items-center justify-center rounded-xl border p-4 text-center text-sm text-muted-foreground"
      >
        The map could not be laid out. Reload the page to try again.
      </p>
    );
  }
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
      proOptions={{ hideAttribution: true }}
      className="rounded-xl border"
    >
      <Background />
      <ZoomControls />
    </ReactFlow>
  );
}
