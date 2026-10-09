"use client";

import { type MouseEvent, useEffect, useState, useTransition } from "react";
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
import {
  countMaterialChats,
  deleteMaterial,
} from "@/features/courses/server/actions";
import type { MaterialListItem } from "@/features/courses/types";

type DeleteMaterialDialogProps = {
  material: MaterialListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * In how many Chats the Material is attached, loaded when the confirmation
 * opens. Nothing shows while it loads, when it fails, or for none.
 */
function AttachedInChats({ materialId }: { materialId: string }) {
  const [chatCount, setChatCount] = useState<number | null>(null);

  useEffect(() => {
    let current = true;
    countMaterialChats({ materialId }).then(
      (result) => current && result.ok && setChatCount(result.data.chatCount),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [materialId]);

  if (!chatCount) return null;
  return (
    <p className="text-sm text-muted-foreground">
      It is attached in {chatCount === 1 ? "1 chat" : `${chatCount} chats`}.
      Those messages will show it as a deleted file, and the AI will no longer
      see it.
    </p>
  );
}

/** Asks before deleting a Material and its file for good. */
export function DeleteMaterialDialog({
  material,
  open,
  onOpenChange,
}: DeleteMaterialDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete(event: MouseEvent) {
    // Stay open until the Material is gone, or to show why it is not.
    event.preventDefault();
    startTransition(async () => {
      const result = await deleteMaterial({ materialId: material.id });
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
          <AlertDialogTitle>Delete material?</AlertDialogTitle>
          <AlertDialogDescription>
            “{material.name}” will be deleted for good. This cannot be undone.
          </AlertDialogDescription>
          {open && <AttachedInChats materialId={material.id} />}
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
