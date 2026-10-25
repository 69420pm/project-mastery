"use client";

import { BookOpenIcon, CheckIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { ShownReading } from "@/features/chat/domain/reply-steps";
import { useSourcePane } from "@/features/chat/hooks/use-source-pane";

/**
 * A Reading section the AI opened: its label, the question the Student
 * reads it for, Open to show it in the source pane and Done to say they
 * have read it. A done card shows Read instead of Done.
 */
export function ReadingCard({
  reading,
  done,
  canAnswer,
  autoOpen,
  onDone,
}: {
  reading: ShownReading;
  /** Whether a later Student message marked it read (`doneReadings`). */
  done: boolean;
  /** False while a reply is on its way, at the Daily limit or once ended. */
  canAnswer: boolean;
  /** Opens the pane on mounting, as when the card arrives in a reply. */
  autoOpen: boolean;
  onDone: () => void;
}) {
  const pane = useSourcePane();
  const { id, sectionId } = reading;
  const open = () =>
    pane?.openSource({ kind: "section", id: sectionId, cardId: id });
  // Once, when the card first shows in a streaming reply.
  const opened = useRef(false);
  useEffect(() => {
    if (!autoOpen || opened.current || !pane) return;
    opened.current = true;
    pane.openSource({ kind: "section", id: sectionId, cardId: id });
  }, [autoOpen, pane, sectionId, id]);

  return (
    <section
      aria-label="Reading"
      data-testid="reading-card"
      data-reading-state={done ? "done" : "open"}
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
        {done ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <CheckIcon className="size-4" />
            Read
          </span>
        ) : (
          <Button size="sm" disabled={!canAnswer} onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    </section>
  );
}
