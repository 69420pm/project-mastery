"use client";

import { useEffect, useState } from "react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { deleteMaterial } from "@/features/courses/server/actions";
import type { MaterialListItem } from "@/features/courses/types";
import type { ActionResult } from "@/lib/validation/action";

/** The Chat feature's action counting the Chats that attach a Material. */
export type CountMaterialChats = (input: {
  materialId: string;
}) => Promise<ActionResult<{ chatCount: number }>>;

type DeleteMaterialDialogProps = {
  material: MaterialListItem;
  countMaterialChats: CountMaterialChats;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * In how many Chats the Material is attached, loaded when the confirmation
 * opens. Nothing shows while it loads, when it fails, or for none.
 */
function AttachedInChats({
  materialId,
  countMaterialChats,
}: {
  materialId: string;
  countMaterialChats: CountMaterialChats;
}) {
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
  }, [materialId, countMaterialChats]);

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
  countMaterialChats,
  open,
  onOpenChange,
}: DeleteMaterialDialogProps) {
  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete material?"
      description={`“${material.name}” will be deleted for good. This cannot be undone.`}
      onConfirm={() => deleteMaterial({ materialId: material.id })}
    >
      {open && (
        <AttachedInChats
          materialId={material.id}
          countMaterialChats={countMaterialChats}
        />
      )}
    </ConfirmDeleteDialog>
  );
}
