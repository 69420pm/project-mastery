"use client";

import { FileTextIcon, ImageIcon } from "lucide-react";
import { useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { materialTypeLabel } from "@/features/courses/domain/material-format";
import type { MaterialListItem } from "@/features/courses/types";

type MaterialPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The Course's Materials, newest first. */
  materials: MaterialListItem[];
  /** The ids of the Materials already picked. */
  pickedIds: string[];
  /** The most Materials that can be picked. */
  max: number;
  /** Picks a Material, or unpicks a picked one. */
  onToggle: (material: MaterialListItem) => void;
};

/**
 * A searchable list of the Course's Materials to attach to a message. It
 * stays open, so several can be picked in a row.
 */
export function MaterialPicker({
  open,
  onOpenChange,
  materials,
  pickedIds,
  max,
  onToggle,
}: MaterialPickerProps) {
  const [limitHit, setLimitHit] = useState(false);

  function toggle(material: MaterialListItem) {
    const picked = pickedIds.includes(material.id);
    if (!picked && pickedIds.length >= max) {
      setLimitHit(true);
      return;
    }
    setLimitHit(false);
    onToggle(material);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        setLimitHit(false);
        onOpenChange(next);
      }}
      title="Choose from materials"
      description="Pick materials of this course to attach to your message."
      showCloseButton
    >
      <Command>
        <CommandInput placeholder="Search materials…" />
        {limitHit && (
          <p role="alert" className="px-3 pt-2 text-sm text-destructive">
            Attach up to {max} materials to a message.
          </p>
        )}
        <CommandList aria-label="Materials">
          <CommandEmpty>
            {materials.length === 0
              ? "This course has no materials yet."
              : "No material matches."}
          </CommandEmpty>
          <CommandGroup>
            {materials.map((material) => (
              <CommandItem
                key={material.id}
                // Searched by name; the id keeps equal names apart.
                value={`${material.name} ${material.id}`}
                keywords={[material.name]}
                data-checked={pickedIds.includes(material.id)}
                aria-selected={pickedIds.includes(material.id)}
                onSelect={() => toggle(material)}
              >
                {material.mediaType === "application/pdf" ? (
                  <FileTextIcon />
                ) : (
                  <ImageIcon />
                )}
                <span className="truncate">{material.name}</span>
                <span className="text-xs text-muted-foreground">
                  {materialTypeLabel(material.mediaType)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
