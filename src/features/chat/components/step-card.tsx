"use client";

import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Markdown } from "@/components/markdown";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ReplyStep, StepDetail } from "@/features/chat/domain/reply-steps";
import { scheduleText } from "@/features/study";
import { cn } from "@/lib/utils";

/**
 * One tool call of an AI reply: a collapsed line that says what it did, and
 * what it returned when expanded. It shimmers while it runs and shows the
 * error the AI got back when it failed.
 */
export function StepCard({ step }: { step: ReplyStep }) {
  const failed = step.state === "error";
  return (
    <Collapsible
      data-testid="step-card"
      data-step-state={step.state}
      className={cn(
        "w-full rounded-md border text-sm",
        failed && "border-destructive/50 text-destructive",
        step.state === "stopped" && "text-muted-foreground",
      )}
    >
      <CollapsibleTrigger
        disabled={step.detail === null}
        className="group flex w-full items-center gap-2 px-3 py-2 text-left disabled:cursor-default"
      >
        <ChevronRightIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90",
            step.detail === null && "invisible",
          )}
        />
        {step.state === "running" ? (
          <Shimmer as="span" className="truncate">
            {step.summary}
          </Shimmer>
        ) : (
          <span className="truncate">{step.summary}</span>
        )}
      </CollapsibleTrigger>
      {failed && step.errorText && (
        <p className="px-3 pb-2 pl-9 whitespace-pre-wrap">{step.errorText}</p>
      )}
      {step.detail && (
        <CollapsibleContent className="border-t px-3 py-2">
          <StepDetails detail={step.detail} />
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

function StepDetails({ detail }: { detail: StepDetail }) {
  switch (detail.tool) {
    case "getTopic":
      return (
        <Items>
          <li className="text-muted-foreground">
            {detail.topic.centralQuestion}
          </li>
          {detail.topic.kcs.map((kc) => (
            <li key={kc.id} className="flex flex-col gap-1">
              <p>
                <span className="font-medium">{kc.name}</span>{" "}
                <span className="text-muted-foreground">
                  · {kc.type} · {kc.state}
                </span>
              </p>
              <p className="text-muted-foreground">{kc.description}</p>
              {kc.sources.map((source, i) => (
                <Fold
                  key={i}
                  label={`${source.material}, ${source.pages}`}
                  link={source.link}
                >
                  <Markdown>{source.markdown}</Markdown>
                </Fold>
              ))}
            </li>
          ))}
        </Items>
      );
    case "findExercises":
      return (
        <Items>
          {detail.note && (
            <li className="text-muted-foreground">{detail.note}</li>
          )}
          {detail.exercises.map((exercise) => (
            <li key={exercise.id} className="flex flex-col gap-1">
              <p>
                <span className="font-medium">{exercise.name}</span>{" "}
                <span className="text-muted-foreground">
                  · {exercise.taskType} · difficulty {exercise.difficulty}/3
                </span>
              </p>
              <p className="text-muted-foreground">
                KCs: {exercise.kcs.map(({ name }) => name).join(", ")}
              </p>
              <Markdown>{exercise.question}</Markdown>
              <Fold label={`Solution: ${exercise.solution.status}`}>
                {exercise.solution.markdown === null ? (
                  <p className="text-muted-foreground">No solution.</p>
                ) : (
                  <Markdown>{exercise.solution.markdown}</Markdown>
                )}
              </Fold>
            </li>
          ))}
        </Items>
      );
    case "remember":
      return <p>{detail.text}</p>;
    case "grade":
      return (
        <Items>
          {detail.kcs.map((kc) => (
            <li key={kc.id}>
              <span className="font-medium">{kc.name}</span>{" "}
              <span className="text-muted-foreground">
                · {kc.result} · {scheduleText(kc)}
              </span>
            </li>
          ))}
        </Items>
      );
    case "other":
      return (
        <div className="flex flex-col gap-2">
          <Json label="Input" value={detail.input} />
          <Json label="Output" value={detail.output} />
        </div>
      );
  }
}

function Items({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col gap-3">{children}</ul>;
}

/** A collapsed block inside an expanded card, such as a source's Markdown. */
function Fold({
  label,
  link,
  children,
}: {
  label: string;
  link?: string;
  children: ReactNode;
}) {
  return (
    <Collapsible className="rounded border px-2 py-1">
      <div className="flex items-center gap-2">
        <CollapsibleTrigger className="group flex items-center gap-1 text-left text-muted-foreground">
          <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
          {label}
        </CollapsibleTrigger>
        {link && (
          <a
            href={link}
            className="text-xs underline underline-offset-2"
            target="_blank"
            rel="noreferrer"
          >
            Open
          </a>
        )}
      </div>
      <CollapsibleContent className="pt-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
