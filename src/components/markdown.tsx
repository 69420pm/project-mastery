"use client";

import { createMathPlugin } from "@streamdown/math";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

/**
 * Streamdown plugins for AI answers. Math is rendered with KaTeX, whose CSS
 * the root layout loads once. Both `$...$` and `$$...$$` are math, because
 * models write inline LaTeX with single dollars.
 */
export const markdownPlugins = {
  math: createMathPlugin({ singleDollarTextMath: true }),
};

type MarkdownProps = {
  /** Markdown source, possibly incomplete while it streams in. */
  children: string;
  /** True while tokens are still arriving: animates new words in. */
  streaming?: boolean;
  className?: string;
};

/**
 * Renders markdown with LaTeX math, including partial streamed answers. Use
 * it for AI answers instead of AI Elements' `MessageResponse`, which keeps
 * the registry defaults (no single-dollar math).
 */
export function Markdown({
  children,
  streaming = false,
  className,
}: MarkdownProps) {
  return (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      plugins={markdownPlugins}
      animated
      isAnimating={streaming}
    >
      {children}
    </Streamdown>
  );
}
