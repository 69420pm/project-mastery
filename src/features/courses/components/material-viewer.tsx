"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MaterialFile } from "@/features/courses/components/material-file";
import type { MaterialListItem } from "@/features/courses/types";

/**
 * Shows a Material in a dialog: PDFs in the PDF viewer, images as images.
 * The file loads from a short-lived link the server signs on opening.
 */
export function MaterialViewer({
  material,
  onClose,
}: {
  /** The Material to show, or null when the viewer is closed. */
  material: MaterialListItem | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={material !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[90dvh] flex-col sm:max-w-3xl"
      >
        {material && (
          <>
            <DialogHeader>
              <DialogTitle className="truncate pr-8">
                {material.name}
              </DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-auto">
              {/* Keyed, so each Material starts loading afresh. */}
              <MaterialFile
                key={material.id}
                materialId={material.id}
                name={material.name}
              />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
