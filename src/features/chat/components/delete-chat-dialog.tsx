"use client";

import { type MouseEvent, useState, useTransition } from "react";
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
import { deleteChat } from "@/features/chat/server/actions";
import type { ChatListItem } from "@/features/chat/types";

type DeleteChatDialogProps = {
  chat: ChatListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Whether the Chat is open. Then deleting it lands the Student on a new
   * Chat, after `onLeave`.
   */
  isOpen: boolean;
  onLeave?: () => void;
};

/** Asks before deleting a Chat with its messages for good. */
export function DeleteChatDialog({
  chat,
  open,
  onOpenChange,
  isOpen,
  onLeave,
}: DeleteChatDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete(event: MouseEvent) {
    // Stay open until the Chat is gone, or to show why it is not.
    event.preventDefault();
    startTransition(async () => {
      if (isOpen) onLeave?.();
      const result = await deleteChat({ chatId: chat.id, leave: isOpen });
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
          <AlertDialogTitle>Delete chat?</AlertDialogTitle>
          <AlertDialogDescription>
            “{chat.label}” and all its messages will be deleted permanently.
          </AlertDialogDescription>
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
