"use client";

import { type FormEvent, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        {/* Mounted per opening, so it starts from the current name. */}
        <RenameChatForm chat={chat} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function RenameChatForm({
  chat,
  onDone,
}: {
  chat: ChatListItem;
  onDone: () => void;
}) {
  const { relabelChat } = useChatList();
  const [title, setTitle] = useState(chat.label);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await renameChat({ chatId: chat.id, title });
      if (!result.ok) {
        setError(result.fieldErrors?.title?.[0] ?? result.message);
        return;
      }
      relabelChat({ id: chat.id, label: title.trim() });
      onDone();
    });
  }

  const inputId = `rename-chat-${chat.id}`;
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Rename chat</DialogTitle>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={error !== null || undefined}>
          <FieldLabel htmlFor={inputId}>Title</FieldLabel>
          <Input
            id={inputId}
            value={title}
            maxLength={MAX_TYPED_TITLE_LENGTH}
            aria-invalid={error !== null}
            onChange={(event) => {
              setTitle(event.target.value);
              setError(null);
            }}
          />
          {error && <FieldError>{error}</FieldError>}
        </Field>
      </FieldGroup>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={isPending}>
          {isPending && <Spinner data-icon="inline-start" />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
