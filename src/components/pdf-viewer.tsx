"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

export type { PdfViewerProps } from "./pdf-viewer-core";

/**
 * PDF viewer that jumps to a given page, e.g. for citations. PDF.js needs
 * browser APIs, so it is loaded on the client only and kept out of the
 * initial bundle.
 */
export const PdfViewer = dynamic(
  () => import("./pdf-viewer-core").then((module) => module.PdfViewerCore),
  {
    ssr: false,
    loading: () => <Skeleton className="aspect-[1/1.414] w-full" />,
  },
);
