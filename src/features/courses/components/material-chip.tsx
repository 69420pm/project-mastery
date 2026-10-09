"use client";

import {
  FileTextIcon,
  FileXIcon,
  ImageIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
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
  /** The upload is under way: the share sent, from 0 to 1. */
  progress?: number;
  /** The upload failed: why, shown on the chip. */
  error?: string;
  /** Uploads the file again after a failure. */
  onRetry?: () => void;
};

/** A Material attached to a Chat message, shown as a small chip. */
export function MaterialChip({
  name,
  mediaType,
  deleted = false,
  onOpen,
  onRemove,
  progress,
  error,
  onRetry,
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
        "relative inline-flex h-7 max-w-80 items-center gap-1 overflow-hidden rounded-md border bg-background text-xs",
        deleted && "border-dashed text-muted-foreground",
        error && "border-destructive",
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
      {error && (
        <span role="alert" className="truncate text-destructive">
          {error}
        </span>
      )}
      {error && onRetry && (
        <button
          type="button"
          aria-label={`Retry ${name}`}
          className="rounded-sm p-0.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onRetry}
        >
          <RotateCwIcon className="size-3.5" />
        </button>
      )}
      {progress !== undefined && !error && (
        <div
          role="progressbar"
          aria-label={`Uploading ${name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="absolute inset-x-0 bottom-0 h-0.5 bg-muted"
        >
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
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
