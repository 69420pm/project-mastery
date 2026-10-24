"use client";

import { Markdown } from "@/components/markdown";
import { StepCard } from "@/features/chat/components/step-card";
import { QuestionCard } from "@/features/chat/components/question-card";
import {
  replySegments,
  type QuestionState,
} from "@/features/chat/domain/reply-steps";
import type { ChatUIMessage } from "@/features/chat/types";

/**
 * An AI reply's text and tool calls in the order they came: text as
 * Markdown, a question it asked as a question card, and each other tool call as
 * a step card.
 */
export function ReplyParts({
  parts,
  streaming,
  inProgress,
  questions,
  canAnswer,
  onAnswer,
}: {
  parts: ChatUIMessage["parts"];
  /** Whether the reply is still streaming in. */
  streaming: boolean;
  /** Whether the reply is still being made, so its open calls are running. */
  inProgress: boolean;
  /** Where the Chat's questions stand (`questionStates`). */
  questions: Map<string, QuestionState>;
  /** Whether the Student can send an answer now. */
  canAnswer: boolean;
  onAnswer: (questionId: string, text: string) => void;
}) {
  const segments = replySegments(parts, { inProgress });
  return segments.map((segment, i) => {
    switch (segment.kind) {
      case "text":
        return (
          <Markdown key={i} streaming={streaming && i === segments.length - 1}>
            {segment.text}
          </Markdown>
        );
      case "question":
        return (
          <QuestionCard
            key={segment.question.id}
            question={segment.question}
            state={questions.get(segment.question.id)}
            canAnswer={canAnswer}
            onAnswer={(text) => onAnswer(segment.question.id, text)}
          />
        );
      case "step":
        return <StepCard key={segment.step.id} step={segment.step} />;
    }
  });
}
