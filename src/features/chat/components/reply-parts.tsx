"use client";

import { Markdown } from "@/components/markdown";
import { StepCard } from "@/features/chat/components/step-card";
import { replySegments } from "@/features/chat/domain/reply-steps";
import type { ChatUIMessage } from "@/features/chat/types";

/**
 * An AI reply's text and tool calls in the order they came: text as
 * Markdown, each tool call as a step card.
 */
export function ReplyParts({
  parts,
  streaming,
}: {
  parts: ChatUIMessage["parts"];
  /** Whether the reply is still streaming in. */
  streaming: boolean;
}) {
  const segments = replySegments(parts);
  return segments.map((segment, i) =>
    segment.kind === "text" ? (
      <Markdown key={i} streaming={streaming && i === segments.length - 1}>
        {segment.text}
      </Markdown>
    ) : (
      <StepCard key={segment.step.id} step={segment.step} />
    ),
  );
}
