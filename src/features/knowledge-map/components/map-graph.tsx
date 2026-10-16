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
} from "lucide-react";
import { useMemo } from "react";
import { Markdown } from "@/components/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import type { KcType } from "@/features/knowledge-map/schemas";
import { TYPE_NAMES } from "@/features/knowledge-map/domain/kc-labels";
import {
  buildMapGraph,
  nodeLayouts,
  toElkGraph,
} from "@/features/knowledge-map/domain/map-graph";
import { useGraphLayout } from "@/features/knowledge-map/hooks/use-graph-layout";
import type {
  KcView,
  KnowledgeMapView,
  MapKcLearning,
} from "@/features/knowledge-map/types";
import { cn } from "@/lib/utils";

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

type KcNodeData = { kc: KcView; state: KcState; selected: boolean };
type BigIdeaNodeData = { name: string };
type KcNode = Node<KcNodeData, "kc">;
type BigIdeaNode = Node<BigIdeaNodeData, "bigIdea">;

/** A KC: its type icon, name and state marker. */
function KcNodeView({ data }: NodeProps<KcNode>) {
  const { kc, state, selected } = data;
  const Icon = TYPE_ICONS[kc.type];
  const marker = STATE_MARKERS[state];
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="opacity-0"
      />
      <button
        type="button"
        aria-label={kc.name}
        aria-pressed={selected}
        className={cn(
          "flex size-full items-start gap-2 rounded-lg border bg-card px-3 py-2 text-left text-sm shadow-xs transition-colors hover:border-ring",
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
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="opacity-0"
      />
    </>
  );
}

/** A Big idea: a box around its KCs, with its name on top. */
function BigIdeaNodeView({ data }: NodeProps<BigIdeaNode>) {
  return (
    <div className="size-full rounded-xl border border-dashed bg-muted/40 px-4 py-2.5">
      <div className="truncate text-sm font-semibold text-muted-foreground">
        <Markdown>{data.name}</Markdown>
      </div>
    </div>
  );
}

const nodeTypes = { kc: KcNodeView, bigIdea: BigIdeaNodeView };

/**
 * The Knowledge map as a graph laid out left to right in learning order:
 * each Big idea a box of its KCs, prior knowledge leftmost, Prerequisites
 * as arrows. A skeleton shows until the first layout. Clicking a KC calls
 * `onSelect` with its id.
 */
export function MapGraph({
  map,
  learning,
  selectedId,
  onSelect,
}: {
  map: KnowledgeMapView;
  learning: MapKcLearning;
  selectedId: string | null;
  onSelect: (kcId: string) => void;
}) {
  const graph = useMemo(() => buildMapGraph(map), [map]);
  const elkGraph = useMemo(() => toElkGraph(graph), [graph]);
  const laidOut = useGraphLayout(elkGraph);

  const { nodes, edges } = useMemo(() => {
    const layouts = laidOut ? nodeLayouts(laidOut) : new Map();
    const kcs = new Map(
      [...map.bigIdeas.flatMap((b) => b.kcs), ...map.priorKnowledge].map(
        (kc) => [kc.id, kc],
      ),
    );
    const bigIdeaName = new Map(map.bigIdeas.map((b) => [b.id, b.name]));
    const nodes: Array<KcNode | BigIdeaNode> = [];
    const shown = new Set<string>();
    for (const node of graph.nodes) {
      const layout = layouts.get(node.id);
      // A node the last layout hasn't placed waits for the next one.
      if (!layout) continue;
      const common = {
        id: node.id,
        position: { x: layout.x, y: layout.y },
        width: layout.width,
        height: layout.height,
      };
      if (node.kind === "bigIdea") {
        nodes.push({
          ...common,
          type: "bigIdea",
          data: { name: bigIdeaName.get(node.id) ?? "" },
          selectable: false,
          focusable: false,
        });
      } else {
        if (node.parentId !== null && !shown.has(node.parentId)) continue;
        nodes.push({
          ...common,
          type: "kc",
          ...(node.parentId !== null && { parentId: node.parentId }),
          data: {
            kc: kcs.get(node.id)!,
            state: learning[node.id]?.state ?? "new",
            selected: node.id === selectedId,
          },
          focusable: false,
        });
      }
      shown.add(node.id);
    }
    const edges: Edge[] = graph.edges
      .filter((edge) => shown.has(edge.source) && shown.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        markerEnd: { type: MarkerType.ArrowClosed },
        focusable: false,
      }));
    return { nodes, edges };
  }, [graph, laidOut, map, learning, selectedId]);

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
      onNodeClick={(_, node) => {
        if (node.type === "kc") onSelect(node.id);
      }}
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
