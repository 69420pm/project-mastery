"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { PageCropFrame, type PageBox } from "@/components/page-crop-frame";
import { Skeleton } from "@/components/ui/skeleton";

export type PageCropProps = {
  /** URL of the PDF or image. */
  file: string;
  mediaType: string;
  /** 1-based page of a PDF; an image is its own one page. */
  page: number;
  /** Where to look on the page, normalized 0 to 1; null shows all of it. */
  box: PageBox | null;
  /** What the part shows, for assistive technology. */
  alt: string;
  className?: string;
};

/** PDF.js needs browser APIs, so it is loaded on the client only. */
const PdfPageCrop = dynamic(
  () => import("./pdf-page-crop-core").then((module) => module.PdfPageCropCore),
  { ssr: false, loading: () => <Skeleton className="aspect-[4/3] w-full" /> },
);

/**
 * Shows a box of a page of a file the app stores (a PDF page, or an uploaded
 * image) by cropping the file itself in the browser, so no picture of the
 * part is stored.
 */
export function PageCrop({
  file,
  mediaType,
  page,
  box,
  alt,
  className,
}: PageCropProps) {
  return mediaType === "application/pdf" ? (
    <PdfPageCrop
      file={file}
      page={page}
      box={box}
      alt={alt}
      className={className}
    />
  ) : (
    <ImageCrop file={file} box={box} alt={alt} className={className} />
  );
}

function ImageCrop({
  file,
  box,
  alt,
  className,
}: Pick<PageCropProps, "file" | "box" | "alt" | "className">) {
  const [aspect, setAspect] = useState<number>();
  return (
    <PageCropFrame
      box={box}
      aspect={aspect ?? 4 / 3}
      label={alt}
      className={className}
    >
      {/* A signed Storage link: served as is, not optimized. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={file}
        alt=""
        className="block w-full max-w-none"
        onLoad={(event) =>
          setAspect(
            event.currentTarget.naturalWidth /
              event.currentTarget.naturalHeight,
          )
        }
      />
    </PageCropFrame>
  );
}
