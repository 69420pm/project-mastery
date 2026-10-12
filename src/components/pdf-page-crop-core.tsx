"use client";

import "client-only";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Page, pdfjs } from "react-pdf";
import {
  PageCropFrame,
  shownBox,
  type PageBox,
} from "@/components/page-crop-frame";
import { useElementWidth } from "@/hooks/use-element-width";

// Must be set in the module that renders <Page>, see the react-pdf README.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type PDFDocumentProxy = Exclude<
  ComponentProps<typeof Page>["pdf"],
  false | undefined
>;
type PDFDocumentLoadingTask = ReturnType<typeof pdfjs.getDocument>;

/** A4 and US Letter alike, until the page is loaded. */
const DEFAULT_ASPECT = 1 / 1.35;

/**
 * The PDF last asked for, shared by every crop of it on the page: opening it
 * once, not once per figure. Another file replaces and closes it.
 */
let shared: { file: string; task: PDFDocumentLoadingTask } | undefined;

function sharedDocument(file: string): Promise<PDFDocumentProxy> {
  if (shared?.file === file) return shared.task.promise;
  void shared?.task.destroy();
  const task = pdfjs.getDocument({ url: file });
  shared = { file, task };
  return task.promise;
}

type PdfPageCropProps = {
  file: string;
  /** 1-based. */
  page: number;
  /** Null shows the whole page. */
  box: PageBox | null;
  alt: string;
  className?: string;
};

/**
 * Shows a box of one page of a PDF, rendered in the browser from the file
 * itself. Import `PageCrop` instead, which loads this only in the browser.
 */
export function PdfPageCropCore({
  file,
  page,
  box,
  alt,
  className,
}: PdfPageCropProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(frameRef);
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [failed, setFailed] = useState(false);
  const [aspect, setAspect] = useState(DEFAULT_ASPECT);

  useEffect(() => {
    let current = true;
    sharedDocument(file).then(
      (document) => current && setPdf(document),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [file]);

  if (failed) {
    return (
      <p role="alert" className="text-sm text-destructive">
        The page could not be loaded.
      </p>
    );
  }

  return (
    <PageCropFrame
      ref={frameRef}
      box={box}
      aspect={aspect}
      label={alt}
      className={className}
    >
      {pdf && width ? (
        <Page
          pdf={pdf}
          pageNumber={page}
          width={width / shownBox(box).width}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          loading={null}
          onLoadSuccess={(loaded) =>
            setAspect(loaded.originalWidth / loaded.originalHeight)
          }
          onLoadError={() => setFailed(true)}
        />
      ) : null}
    </PageCropFrame>
  );
}
