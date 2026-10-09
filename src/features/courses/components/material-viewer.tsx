"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { PdfViewer } from "@/components/pdf-viewer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { openMaterial } from "@/features/courses/server/actions";
import type { MaterialListItem } from "@/features/courses/types";

type Opened =
  | { status: "loading" }
  | { status: "open"; url: string; mediaType: string }
  | { status: "failed"; message: string };

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
          // Keyed, so each Material starts loading afresh.
          <MaterialView key={material.id} material={material} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MaterialView({ material }: { material: MaterialListItem }) {
  const [opened, setOpened] = useState<Opened>({ status: "loading" });

  useEffect(() => {
    let current = true;
    void openMaterial({ materialId: material.id }).then(
      (result) => {
        if (!current) return;
        setOpened(
          result.ok
            ? { status: "open", ...result.data }
            : { status: "failed", message: result.message },
        );
      },
      () =>
        current &&
        setOpened({
          status: "failed",
          message: "The material could not be opened. Please try again.",
        }),
    );
    return () => {
      current = false;
    };
  }, [material.id]);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="truncate pr-8">{material.name}</DialogTitle>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-auto">
        {opened.status === "loading" && (
          <Skeleton className="aspect-[1/1.414] w-full" />
        )}
        {opened.status === "failed" && (
          <p role="alert" className="text-sm text-destructive">
            {opened.message}
          </p>
        )}
        {opened.status === "open" &&
          (opened.mediaType === "application/pdf" ? (
            <PdfViewer file={opened.url} />
          ) : (
            <div className="relative h-[70dvh] w-full">
              {/* A signed Storage link: served as is, not optimized. */}
              <Image
                src={opened.url}
                alt={material.name}
                fill
                unoptimized
                sizes="(min-width: 640px) 48rem, 100vw"
                className="object-contain"
              />
            </div>
          ))}
      </div>
    </>
  );
}
