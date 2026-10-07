"use client";

import "client-only";
import { useControllableState } from "@radix-ui/react-use-controllable-state";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs, type DocumentProps } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Must be set in the module that renders <Document>, see the react-pdf README.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export type PdfViewerProps = {
  /**
   * URL, `File` or `{ data }` object. Memoize objects: a new object on every
   * render reloads the document.
   */
  file: DocumentProps["file"];
  /** 1-based page to show. Set it to jump, e.g. to a cited page. */
  page?: number;
  /** Initial page when `page` is not controlled. */
  defaultPage?: number;
  onPageChange?: (page: number) => void;
  className?: string;
};

/**
 * Shows one PDF page at a time, fitted to the container width, with a
 * selectable text layer and clickable links. Import `PdfViewer` instead,
 * which loads this only in the browser.
 */
export function PdfViewerCore({
  file,
  page: pageProp,
  defaultPage = 1,
  onPageChange,
  className,
}: PdfViewerProps) {
  const [page, setPage] = useControllableState({
    prop: pageProp,
    defaultProp: defaultPage,
    onChange: onPageChange,
  });
  const [numPages, setNumPages] = useState<number>();
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);

  const currentPage = numPages ? clamp(page, 1, numPages) : page;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto">
        <Document
          file={file}
          suspense={false}
          onLoadSuccess={(document) => setNumPages(document.numPages)}
          // Links inside the PDF, e.g. a table of contents.
          onItemClick={({ pageNumber }) => setPage(pageNumber)}
          loading={<PageSkeleton />}
          error={
            <p role="alert" className="p-4 text-sm text-destructive">
              The document could not be loaded.
            </p>
          }
        >
          {width ? (
            <Page
              pageNumber={currentPage}
              width={width}
              suspense={false}
              loading={<PageSkeleton />}
              className="mx-auto"
            />
          ) : null}
        </Document>
      </div>
      {numPages ? (
        <nav
          aria-label="Pages"
          className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous page"
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeftIcon />
          </Button>
          <span aria-live="polite" className="tabular-nums">
            Page {currentPage} of {numPages}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next page"
            disabled={currentPage >= numPages}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRightIcon />
          </Button>
        </nav>
      ) : null}
    </div>
  );
}

function PageSkeleton() {
  return <Skeleton className="aspect-[1/1.414] w-full" />;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Tracks an element's content width, so pages fit their container. */
function useElementWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState<number>();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
