"use client";

import { FileTextIcon, FileXIcon, ImageIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type MaterialChipProps = {
  /** The Material's current name, or its name when attached if deleted. */
  name: string;
  mediaType: string;
  /** The Material was deleted: the chip says so and cannot be opened. */
  deleted?: boolean;
  /** Opens the Material in the viewer. */
  onOpen?: () => void;
  /** Removes the Material from a message that is not sent yet. */
  onRemove?: () => void;
};

/** A Material attached to a Chat message, shown as a small chip. */
export function MaterialChip({
  name,
  mediaType,
  deleted = false,
  onOpen,
  onRemove,
}: MaterialChipProps) {
  const Icon = deleted
    ? FileXIcon
    : mediaType === "application/pdf"
      ? FileTextIcon
      : ImageIcon;
  const label = deleted ? `Deleted file: ${name}` : name;
  const content = (
    <>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </>
  );

  return (
    <span
      data-testid="material-chip"
      className={cn(
        "inline-flex h-7 max-w-64 items-center gap-1 rounded-md border bg-background text-xs",
        deleted && "border-dashed text-muted-foreground",
      )}
    >
      {onOpen && !deleted ? (
        <button
          type="button"
          className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onOpen}
        >
          {content}
        </button>
      ) : (
        <span className="inline-flex min-w-0 items-center gap-1.5 px-2 py-1">
          {content}
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          className="mr-1 rounded-sm p-0.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onRemove}
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </span>
  );
}
