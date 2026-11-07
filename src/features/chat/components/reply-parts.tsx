"use client";

import { Markdown } from "@/components/markdown";
import { chatMarkdownComponents } from "@/features/chat/components/citation-link";
import { StepCard } from "@/features/chat/components/step-card";
import { ReadingCard } from "@/features/chat/components/reading-card";
import {
  replySegments,
  type ReplySegment,
} from "@/features/chat/domain/reply-steps";
import type { ChatUIMessage } from "@/features/chat/types";
import { ProblemFlagControl, type ProblemFlag } from "@/features/study";

/**
 * An AI reply's text and tool calls in the order they came: text as
 * Markdown, a question it asked inline as the AI's question, a reading it
 * opened as a reading card, and, with `showSteps`, each other tool call as
 * a step card.
 */
export function ReplyParts({
  parts,
  streaming,
  inProgress,
  arrived,
  showSteps,
  problemFlags,
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
  /** The stored flags of the generated Problems posed, by Problem id. */
  problemFlags: Record<string, ProblemFlag>;
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
          <QuestionView
            key={segment.question.id}
            question={segment.question}
            problemFlags={problemFlags}
          />
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

type Question = Extract<ReplySegment, { kind: "question" }>["question"];

/**
 * A question as part of the reply, answered in the normal input: its
 * prompt, or the Problem it poses, with an Exercise's page link, which
 * opens in the source pane, and a generated Problem's flag control.
 */
function QuestionView({
  question,
  problemFlags,
}: {
  question: Question;
  problemFlags: Record<string, ProblemFlag>;
}) {
  const { problem } = question;
  return (
    <div data-testid="question" className="flex flex-col gap-2">
      <Markdown components={chatMarkdownComponents}>
        {problem?.statement ?? question.prompt}
      </Markdown>
      {problem?.page && (
        <Markdown components={chatMarkdownComponents}>
          {`[${problem.page.label}](${problem.page.link})`}
        </Markdown>
      )}
      {problem?.generatedProblemId && (
        <ProblemFlagControl
          problemId={problem.generatedProblemId}
          flag={problemFlags[problem.generatedProblemId]}
        />
      )}
    </div>
  );
}
