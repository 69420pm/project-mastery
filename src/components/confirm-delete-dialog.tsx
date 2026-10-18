"use client";

import {
  type MouseEvent,
  type ReactNode,
  useState,
  useTransition,
} from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import type { ActionResult } from "@/lib/validation/action";

type ConfirmDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  /** More text under the description, such as what else goes with it. */
  children?: ReactNode;
  /** Deletes the thing. A failure keeps the dialog open with its message. */
  onConfirm: () => Promise<ActionResult<unknown>>;
};

/** Asks before deleting something for good, and stays open until it is gone. */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete(event: MouseEvent) {
    // Stay open until the deletion is done, or to show why it failed.
    event.preventDefault();
    startTransition(async () => {
      const result = await onConfirm();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onOpenChange(false);
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setError(null);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          {children}
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isPending}
            onClick={handleDelete}
          >
            {isPending && <Spinner data-icon="inline-start" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
