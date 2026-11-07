"use client";

import { BookOpenIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { ShownReading } from "@/features/chat/domain/reply-steps";
import { useSourcePane } from "@/features/chat/hooks/use-source-pane";

/**
 * A Reading section the AI opened: its label, the question the Student
 * reads it for, and Open to show it in the source pane.
 */
export function ReadingCard({
  reading,
  autoOpen,
}: {
  reading: ShownReading;
  /** Opens the pane on mounting, as when the card arrives in a reply. */
  autoOpen: boolean;
}) {
  const pane = useSourcePane();
  const { sectionId } = reading;
  const open = () => pane?.openSource({ kind: "section", id: sectionId });
  // Once, when the card first shows in a streaming reply.
  const opened = useRef(false);
  useEffect(() => {
    if (!autoOpen || opened.current || !pane) return;
    opened.current = true;
    pane.openSource({ kind: "section", id: sectionId });
  }, [autoOpen, pane, sectionId]);

  return (
    <section
      aria-label="Reading"
      data-testid="reading-card"
      className="flex w-full flex-col gap-3 rounded-lg border bg-card p-4 text-sm sm:min-w-md"
    >
      <p className="flex items-center gap-1.5 font-medium">
        <BookOpenIcon className="size-4" />
        {reading.label}
      </p>
      <p>{reading.purpose}</p>
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="outline" onClick={open}>
          Open
        </Button>
      </div>
    </section>
  );
}
