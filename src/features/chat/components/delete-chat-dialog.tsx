"use client";

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
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
  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete chat?"
      description={`“${chat.label}” and all its messages will be deleted permanently.`}
      onConfirm={() => {
        if (isOpen) onLeave?.();
        return deleteChat({ chatId: chat.id, leave: isOpen });
      }}
    />
  );
}
