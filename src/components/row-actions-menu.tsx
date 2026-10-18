"use client";

import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type RowActionsMenuProps = {
  /** The accessible name of the "…" button. */
  label: string;
  onRename: () => void;
  onDelete: () => void;
  /**
   * The "…" button, when a ghost icon button does not fit. It needs its own
   * accessible name and the icon.
   */
  trigger?: ReactElement;
  side?: ComponentProps<typeof DropdownMenuContent>["side"];
  align?: ComponentProps<typeof DropdownMenuContent>["align"];
};

/** A row's "…" menu with Rename and Delete. */
export function RowActionsMenu({
  label,
  onRename,
  onDelete,
  trigger,
  side,
  align = "end",
}: RowActionsMenuProps) {
  return (
    // Not modal, so focus moves cleanly into a dialog opened from it.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon" aria-label={label}>
            <MoreHorizontalIcon />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align}>
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onRename}>
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
