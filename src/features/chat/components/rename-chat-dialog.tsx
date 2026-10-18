"use client";

import { NameDialog } from "@/components/name-dialog";
import { useChatList } from "@/features/chat/hooks/use-chat-list";
import { MAX_TYPED_TITLE_LENGTH } from "@/features/chat/schemas";
import { renameChat } from "@/features/chat/server/actions";
import type { ChatListItem } from "@/features/chat/types";

type RenameChatDialogProps = {
  chat: ChatListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Renames a Chat for good. The sidebar shows the new name at once and the
 * refreshed list from the server confirms it.
 */
export function RenameChatDialog({
  chat,
  open,
  onOpenChange,
}: RenameChatDialogProps) {
  const { relabelChat } = useChatList();

  return (
    <NameDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rename chat"
      label="Title"
      submitLabel="Save"
      initialValue={chat.label}
      maxLength={MAX_TYPED_TITLE_LENGTH}
      onSave={async (title) => {
        const result = await renameChat({ chatId: chat.id, title });
        if (result.ok) relabelChat({ id: chat.id, label: title.trim() });
        return result;
      }}
    />
  );
}
