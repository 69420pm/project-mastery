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
import Link from "next/link";
import { useMemo } from "react";
import { Markdown } from "@/components/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { nodeLayouts } from "@/features/knowledge-map/domain/map-graph";
import { topicPath } from "@/features/knowledge-map/domain/map-paths";
import {
  buildTopicGraph,
  toElkTopicGraph,
} from "@/features/knowledge-map/domain/topic-graph";
import { useGraphLayout } from "@/features/knowledge-map/hooks/use-graph-layout";
import type {
  KnowledgeMapView,
  MapTopic,
  MapTopicState,
  MapTopicStates,
} from "@/features/knowledge-map/types";
import { RecallBar, TopicStateBadge } from "./topic-state";
import { ZoomControls } from "./zoom-controls";

type TopicNodeData = {
  topic: MapTopic;
  href: string;
  topicState?: MapTopicState;
};
type BigIdeaNodeData = { name: string };
type TopicNode = Node<TopicNodeData, "topic">;
type BigIdeaNode = Node<BigIdeaNodeData, "bigIdea">;

/**
 * A Topic: its name, central question, Topic state and recall today,
 * opening the Topic page.
 */
function TopicNodeView({ data }: NodeProps<TopicNode>) {
  const { topic, href, topicState } = data;
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="opacity-0"
      />
      <Link
        href={href}
        aria-label={topic.name}
        // React Flow switches pointer events off on nodes that can't be
        // dragged or selected; the card is a link, so it turns them on.
        className="pointer-events-auto flex size-full flex-col gap-1 rounded-lg border bg-card px-3 py-2 text-left text-sm shadow-xs transition-colors hover:border-ring"
      >
        <div className="line-clamp-2 font-medium">
          <Markdown>{topic.name}</Markdown>
        </div>
        <div className="line-clamp-2 text-xs text-muted-foreground">
          <Markdown>{topic.centralQuestion}</Markdown>
        </div>
        <div className="mt-auto flex items-end gap-3">
          <TopicStateBadge topicState={topicState} />
          <div className="flex-1">
            <RecallBar topicState={topicState} />
          </div>
        </div>
      </Link>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="opacity-0"
      />
    </>
  );
}

/** A Big idea: a box around its Topics, with its name on top. */
function BigIdeaNodeView({ data }: NodeProps<BigIdeaNode>) {
  return (
    <div className="size-full rounded-xl border border-dashed bg-muted/40">
      <div className="truncate px-4 py-2.5 text-sm font-semibold text-muted-foreground">
        <Markdown>{data.name}</Markdown>
      </div>
    </div>
  );
}

const nodeTypes = { topic: TopicNodeView, bigIdea: BigIdeaNodeView };

/**
 * The Course map's graph, laid out left to right in learning order: each
 * Big idea a box of its Topics' cards, with arrows between Topics. A
 * skeleton shows until the first layout. Clicking a card opens its Topic
 * page.
 */
export function CourseMapGraph({
  map,
  topics,
  topicStates,
}: {
  map: KnowledgeMapView;
  topics: MapTopic[];
  topicStates: MapTopicStates;
}) {
  const graph = useMemo(() => buildTopicGraph(topics, map), [topics, map]);
  const elkGraph = useMemo(() => toElkTopicGraph(graph), [graph]);
  const { laidOut, failed } = useGraphLayout(elkGraph);

  const { nodes, edges } = useMemo(() => {
    const layouts = laidOut ? nodeLayouts(laidOut) : new Map<string, never>();
    const shown = new Set<string>();
    const nodes: Array<TopicNode | BigIdeaNode> = [];
    for (const node of graph.nodes) {
      const layout = layouts.get(node.id);
      const parentId = node.kind === "topic" ? node.parentId : null;
      // A node the last layout hasn't placed, or placed in another group,
      // waits for the next one.
      if (!layout || layout.parentId !== parentId) continue;
      if (parentId !== null && !shown.has(parentId)) continue;
      shown.add(node.id);
      const common = {
        id: node.id,
        position: { x: layout.x, y: layout.y },
        width: layout.width,
        height: layout.height,
        focusable: false,
      };
      nodes.push(
        node.kind === "bigIdea"
          ? { ...common, type: "bigIdea", data: { name: node.name } }
          : {
              ...common,
              type: "topic",
              ...(parentId !== null && { parentId }),
              data: {
                topic: node.topic,
                href: topicPath(map.courseId, node.id),
                topicState: topicStates[node.id],
              },
            },
      );
    }
    const edges = graph.edges
      .filter((edge) => shown.has(edge.source) && shown.has(edge.target))
      .map((edge): Edge => ({
        ...edge,
        focusable: false,
        markerEnd: { type: MarkerType.ArrowClosed },
      }));
    return { nodes, edges };
  }, [graph, laidOut, map.courseId, topicStates]);

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
      aria-label="Course map graph"
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
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
