"use client";

import { CheckCircle2Icon, SendIcon } from "lucide-react";
import { useId, useState } from "react";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { chatMarkdownComponents } from "@/features/chat/components/citation-link";
import type {
  AskedQuestion,
  QuestionState,
} from "@/features/chat/domain/reply-steps";
import { MAX_MESSAGE_LENGTH } from "@/features/chat/schemas";
import {
  ProblemFlagControl,
  type GradedKc,
  type ProblemFlag,
} from "@/features/study";
import { cn } from "@/lib/utils";

const RESULT_LABELS: Record<GradedKc["result"], string> = {
  full: "Full",
  partial: "Partial",
  wrong: "Wrong",
};

const RESULT_VARIANTS = {
  full: "default",
  partial: "secondary",
  wrong: "destructive",
} as const;

/**
 * A question the AI asked: its prompt, and an answer box with a live
 * preview while it is open. Once answered it says so and can be answered
 * again, until it is graded; graded, it shows the result on each KC.
 * Feedback stays in the AI's reply. On a generated Problem, the Student can
 * flag it.
 */
export function QuestionCard({
  question,
  state,
  problemFlag,
  canAnswer,
  onAnswer,
}: {
  question: AskedQuestion;
  /** Undefined while the question is open. */
  state: QuestionState | undefined;
  /** The stored flag of its generated Problem; undefined without one. */
  problemFlag?: ProblemFlag | undefined;
  /** False while a reply is on its way or at the Daily limit. */
  canAnswer: boolean;
  onAnswer: (text: string, confidence: number | undefined) => void;
}) {
  const [answering, setAnswering] = useState(false);
  const status = state?.status ?? "open";
  const showBox = status === "open" || (status === "submitted" && answering);
  return (
    <section
      aria-label="Question"
      data-testid="question-card"
      data-question-state={status}
      className="flex w-full flex-col gap-3 rounded-lg border bg-card p-4 text-sm sm:min-w-md"
    >
      <Markdown components={chatMarkdownComponents}>{question.prompt}</Markdown>
      {showBox ? (
        <AnswerBox
          canAnswer={canAnswer}
          onSubmit={(text, confidence) => {
            setAnswering(false);
            onAnswer(text, confidence);
          }}
        />
      ) : status === "submitted" ? (
        <div className="flex items-center justify-between gap-2 text-muted-foreground">
          <span>Answer sent.</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={!canAnswer}
            onClick={() => setAnswering(true)}
          >
            Answer again
          </Button>
        </div>
      ) : (
        state?.status === "graded" && <Grades kcs={state.kcs} />
      )}
      {question.generatedProblemId && (
        <ProblemFlagControl
          problemId={question.generatedProblemId}
          flag={problemFlag}
        />
      )}
    </section>
  );
}

function AnswerBox({
  canAnswer,
  onSubmit,
}: {
  canAnswer: boolean;
  onSubmit: (text: string, confidence: number | undefined) => void;
}) {
  const [text, setText] = useState("");
  const [confidence, setConfidence] = useState<number>();
  const id = useId();
  const tooLong = text.length > MAX_MESSAGE_LENGTH;
  const submittable = canAnswer && text.trim() !== "" && !tooLong;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (submittable) onSubmit(text, confidence);
      }}
    >
      <label htmlFor={id} className="sr-only">
        Your answer
      </label>
      <Textarea
        id={id}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Your answer, with $math$ in LaTeX…"
        aria-invalid={tooLong}
        className="min-h-20"
      />
      {text.trim() !== "" && (
        <div
          aria-label="Preview"
          className="rounded-md border border-dashed px-3 py-2"
        >
          <Markdown>{text}</Markdown>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div
          role="radiogroup"
          aria-label="How sure are you?"
          className="mr-auto flex items-center gap-1.5"
        >
          <span className="text-muted-foreground" aria-hidden>
            How sure are you?
          </span>
          {[1, 2, 3, 4].map((value) => (
            <Button
              key={value}
              type="button"
              role="radio"
              aria-checked={confidence === value}
              aria-label={`Confidence ${value} of 4`}
              size="icon-sm"
              variant={confidence === value ? "default" : "outline"}
              onClick={() =>
                setConfidence(confidence === value ? undefined : value)
              }
            >
              {value}
            </Button>
          ))}
        </div>
        {tooLong && (
          <p role="alert" className="mr-auto text-destructive">
            Keep your answer under {MAX_MESSAGE_LENGTH.toLocaleString("en-US")}{" "}
            characters.
          </p>
        )}
        <Button type="submit" size="sm" disabled={!submittable}>
          <SendIcon />
          Submit
        </Button>
      </div>
    </form>
  );
}

function Grades({ kcs }: { kcs: GradedKc[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-muted-foreground">
        <CheckCircle2Icon className="size-4" />
        Graded
      </p>
      <ul className="flex flex-col gap-1">
        {kcs.map((kc) => (
          <li key={kc.id} className="flex items-center justify-between gap-2">
            <span className={cn(kc.result === "wrong" && "text-destructive")}>
              {kc.name}
            </span>
            <Badge variant={RESULT_VARIANTS[kc.result]}>
              {RESULT_LABELS[kc.result]}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
