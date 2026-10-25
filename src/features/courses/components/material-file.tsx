"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { PdfViewer } from "@/components/pdf-viewer";
import { Skeleton } from "@/components/ui/skeleton";
import { openMaterial } from "@/features/courses/server/actions";

type Opened =
  | { status: "loading" }
  | { status: "open"; url: string; mediaType: string }
  | { status: "failed"; message: string };

/**
 * A Material's file: a PDF in the PDF viewer, at `page` when given, or an
 * image as an image. It loads from a short-lived link the server signs on
 * mounting, so key it by the Material to load another.
 */
export function MaterialFile({
  materialId,
  name,
  page,
}: {
  materialId: string;
  /** The Material's name, the image's alternative text. */
  name: string;
  /** The 1-based PDF page to show first. */
  page?: number;
}) {
  const [opened, setOpened] = useState<Opened>({ status: "loading" });

  useEffect(() => {
    let current = true;
    void openMaterial({ materialId }).then(
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
  }, [materialId]);

  if (opened.status === "loading") {
    return <Skeleton className="aspect-[1/1.414] w-full" />;
  }
  if (opened.status === "failed") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {opened.message}
      </p>
    );
  }
  return opened.mediaType === "application/pdf" ? (
    <PdfViewer file={opened.url} defaultPage={page} />
  ) : (
    <div className="relative h-[70dvh] w-full">
      {/* A signed Storage link: served as is, not optimized. */}
      <Image
        src={opened.url}
        alt={name}
        fill
        unoptimized
        sizes="(min-width: 640px) 48rem, 100vw"
        className="object-contain"
      />
    </div>
  );
}
