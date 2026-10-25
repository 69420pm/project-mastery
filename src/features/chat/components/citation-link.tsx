"use client";

import type { ComponentProps } from "react";
import {
  type Components,
  defaultComponents,
  type ExtraProps,
} from "streamdown";
import { citedChunkId } from "@/features/chat/domain/sources";
import { useSourcePane } from "@/features/chat/hooks/use-source-pane";

const DefaultLink = defaultComponents.a!;

/**
 * A link in a Chat's Markdown. A citation of a chunk of the Chat's Course
 * opens the cited page in the source pane; a modifier or middle click still
 * follows it. Every other link renders as Streamdown renders it.
 */
function ChatLink(props: ComponentProps<"a"> & ExtraProps) {
  const pane = useSourcePane();
  const chunkId = pane && citedChunkId(props.href, pane.courseId);
  if (!pane || !chunkId) return <DefaultLink {...props} />;

  const { href, children, className } = props;
  return (
    <a
      href={href}
      data-streamdown="link"
      className={
        className ?? "font-medium wrap-anywhere text-primary underline"
      }
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        pane.openSource({ kind: "chunk", id: chunkId });
      }}
    >
      {children}
    </a>
  );
}

/** Markdown renderers for a Chat's replies and question cards. */
export const chatMarkdownComponents: Components = { a: ChatLink };
