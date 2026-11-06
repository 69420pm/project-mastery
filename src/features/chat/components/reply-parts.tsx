"use client";

import { Markdown } from "@/components/markdown";
import { chatMarkdownComponents } from "@/features/chat/components/citation-link";
import { StepCard } from "@/features/chat/components/step-card";
import { ReadingCard } from "@/features/chat/components/reading-card";
import { replySegments } from "@/features/chat/domain/reply-steps";
import type { ChatUIMessage } from "@/features/chat/types";

/**
 * An AI reply's text and tool calls in the order they came: text as
 * Markdown, a question it asked as its prompt, a reading it opened as a
 * reading card, and, with `showSteps`, each other tool call as a step card.
 */
export function ReplyParts({
  parts,
  streaming,
  inProgress,
  arrived,
  showSteps,
}: {
  parts: ChatUIMessage["parts"];
  /** Whether the reply is still streaming in. */
  streaming: boolean;
  /** Whether the reply is still being made, so its open calls are running. */
  inProgress: boolean;
  /**
   * Whether the reply arrived while the Chat is open, not with the stored
   * Chat: its reading card then opens the pane on its own.
   */
  arrived: boolean;
  /** Whether the step cards show, outside production only. */
  showSteps: boolean;
}) {
  const segments = replySegments(parts, { inProgress });
  return segments.map((segment, i) => {
    switch (segment.kind) {
      case "text":
        return (
          <Markdown
            key={i}
            streaming={streaming && i === segments.length - 1}
            components={chatMarkdownComponents}
          >
            {segment.text}
          </Markdown>
        );
      case "question":
        return (
          <div key={segment.question.id} data-testid="question">
            <Markdown components={chatMarkdownComponents}>
              {segment.question.prompt}
            </Markdown>
          </div>
        );
      case "reading":
        return (
          <ReadingCard
            key={segment.reading.id}
            reading={segment.reading}
            autoOpen={arrived}
          />
        );
      case "step":
        return showSteps ? (
          <StepCard key={segment.step.id} step={segment.step} />
        ) : null;
    }
  });
}
