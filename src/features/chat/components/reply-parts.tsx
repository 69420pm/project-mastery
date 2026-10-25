"use client";

import { Markdown } from "@/components/markdown";
import { chatMarkdownComponents } from "@/features/chat/components/citation-link";
import { StepCard } from "@/features/chat/components/step-card";
import { QuestionCard } from "@/features/chat/components/question-card";
import { ReadingCard } from "@/features/chat/components/reading-card";
import { KnowledgeMapCard } from "@/features/chat/components/knowledge-map-card";
import {
  replySegments,
  type QuestionState,
} from "@/features/chat/domain/reply-steps";
import type { ChatUIMessage } from "@/features/chat/types";

/**
 * An AI reply's text and tool calls in the order they came: text as
 * Markdown, a question it asked as a question card, a reading it opened as a
 * reading card, a graded rebuild with a Knowledge map card after its step card,
 * and each other tool call as a step card.
 */
export function ReplyParts({
  parts,
  streaming,
  inProgress,
  questions,
  canAnswer,
  onAnswer,
  doneReadings,
  arrived,
  onDoneReading,
  rebuilds,
  topicId,
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
  onAnswer: (
    questionId: string,
    text: string,
    confidence: number | undefined,
  ) => void;
  /** The Chat's reading cards that are done (`doneReadings`). */
  doneReadings: Set<string>;
  /**
   * Whether the reply arrived while the Chat is open, not with the stored
   * Chat: its reading card then opens the pane on its own.
   */
  arrived: boolean;
  onDoneReading: (sectionId: string) => void;
  /** The Chat's rebuild questions (`rebuildQuestions`). */
  rebuilds: Set<string>;
  /** The session's Topic (`sessionTopic`), whose map a graded rebuild opens. */
  topicId: string | null;
}) {
  const segments = replySegments(parts, { inProgress, rebuilds, topicId });
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
          <QuestionCard
            key={segment.question.id}
            question={segment.question}
            state={questions.get(segment.question.id)}
            canAnswer={canAnswer}
            onAnswer={(text, confidence) =>
              onAnswer(segment.question.id, text, confidence)
            }
          />
        );
      case "reading":
        return (
          <ReadingCard
            key={segment.reading.id}
            reading={segment.reading}
            done={doneReadings.has(segment.reading.id)}
            canAnswer={canAnswer}
            autoOpen={arrived}
            onDone={() => onDoneReading(segment.reading.sectionId)}
          />
        );
      case "knowledgeMap":
        return (
          <KnowledgeMapCard
            key={`map-${segment.knowledgeMap.id}`}
            knowledgeMap={segment.knowledgeMap}
            autoOpen={arrived}
          />
        );
      case "step":
        return <StepCard key={segment.step.id} step={segment.step} />;
    }
  });
}
