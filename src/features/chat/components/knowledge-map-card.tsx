"use client";

import { WaypointsIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { KnowledgeMapReveal } from "@/features/chat/domain/reply-steps";
import { useSourcePane } from "@/features/chat/hooks/use-source-pane";

/**
 * After a graded rebuild: Open shows the Topic's part of the Knowledge map,
 * with the Student's KC states, in the side slot, to compare with what they
 * rebuilt.
 */
export function KnowledgeMapCard({
  knowledgeMap,
  autoOpen,
}: {
  knowledgeMap: KnowledgeMapReveal;
  /** Opens the slot on mounting, as when the card arrives in a reply. */
  autoOpen: boolean;
}) {
  const pane = useSourcePane();
  const { topicId } = knowledgeMap;
  // Once, when the card first shows in a streaming reply.
  const opened = useRef(false);
  useEffect(() => {
    if (!autoOpen || opened.current || !pane) return;
    opened.current = true;
    pane.openSource({ kind: "topic", id: topicId });
  }, [autoOpen, pane, topicId]);

  return (
    <section
      aria-label="Knowledge map"
      data-testid="knowledge-map-card"
      className="flex w-full flex-col gap-3 rounded-lg border bg-card p-4 text-sm sm:min-w-md"
    >
      <p className="flex items-center gap-1.5 font-medium">
        <WaypointsIcon className="size-4" />
        Knowledge map
      </p>
      <p>Compare your rebuild with the Topic&apos;s KCs and how they link.</p>
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() => pane?.openSource({ kind: "topic", id: topicId })}
        >
          Open map
        </Button>
      </div>
    </section>
  );
}
