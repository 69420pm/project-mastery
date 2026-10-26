"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MockExamButton } from "@/features/study/components/mock-exam-button";
import { MockResultView } from "@/features/study/components/mock-result";
import { startMockExam } from "@/features/study/server/actions";
import type { MockExamView } from "@/features/study/types";
import { cn } from "@/lib/utils";

/** How often the page refreshes while the mock assembles or is graded. */
const POLL_MS = 2000;

/** Start on a ready mock: the page then shows its task sheet. */
function StartButton({ mockId }: { mockId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <Button
        className="self-start"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await startMockExam({ mockId });
            if (!result.ok) setMessage(result.message);
            router.refresh();
          })
        }
      >
        Start
      </Button>
      {message && (
        <p role="alert" className="text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * A Mock exam's page outside its task sheet (#185, #186): its assembly's
 * progress, polled; once ready its minutes, item count, aids and Start;
 * once failed the reason and Assemble another; once submitted the grading's
 * progress, polled, and the answers; once graded its result.
 */
export function MockExamStatus({
  mock,
  tutorHref,
}: {
  mock: MockExamView;
  /** A new Chat that goes through the graded mock. */
  tutorHref: string;
}) {
  const router = useRouter();
  const polled = mock.status === "assembling" || mock.status === "submitted";
  useEffect(() => {
    if (!polled) return;
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [polled, router]);

  let body;
  switch (mock.status) {
    case "assembling": {
      const { total, done } = mock.gaps;
      body = (
        <p role="status">
          {total > 0 && done < total
            ? `Generating ${done + 1} of ${total} ${total === 1 ? "problem" : "problems"}`
            : "Picking the problems"}
          …
        </p>
      );
      break;
    }
    case "ready":
      body = (
        <>
          <p>
            {mock.durationMinutes} min, {mock.itemCount}{" "}
            {mock.itemCount === 1 ? "task" : "tasks"}
          </p>
          <p>
            Aids: {mock.aids.length > 0 ? mock.aids.join(", ") : "none allowed"}
          </p>
          {mock.final && (
            <p className="text-muted-foreground">This is your reserved exam.</p>
          )}
          <StartButton mockId={mock.id} />
        </>
      );
      break;
    case "submitted":
      body = (
        <>
          <p role="status">
            Grading task {Math.min(mock.grading.done + 1, mock.grading.total)}{" "}
            of {mock.grading.total}…
          </p>
          <ol className="flex flex-col gap-3">
            {mock.tasks.map((task, index) => (
              <li
                key={task.questionId}
                aria-label={`Task ${index + 1}`}
                className="flex flex-col gap-2 rounded-md border p-3"
              >
                <p className="text-muted-foreground">
                  Task {index + 1} · {task.points}{" "}
                  {task.points === 1 ? "point" : "points"}
                </p>
                <Markdown>{task.prompt}</Markdown>
                <div className="border-t pt-2">
                  {task.answer ? (
                    <Markdown>{task.answer}</Markdown>
                  ) : (
                    <p className="text-muted-foreground">No answer</p>
                  )}
                  {task.confidence !== null && (
                    <p className="text-muted-foreground">
                      Confidence {task.confidence} of 4
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </>
      );
      break;
    case "graded":
      body = mock.result && (
        <MockResultView
          result={mock.result}
          tasks={mock.tasks}
          tutorHref={tutorHref}
        />
      );
      break;
    case "failed":
      body = (
        <>
          <p role="alert">{mock.failure}</p>
          <div>
            <MockExamButton
              courseId={mock.courseId}
              openHref={null}
              label="Assemble another"
              variant="default"
            />
          </div>
        </>
      );
      break;
    default:
      body = <p>This mock exam has started.</p>;
  }

  return (
    <Card
      role="region"
      aria-label="Mock exam"
      className={cn(
        "w-full gap-3 py-4",
        mock.status === "submitted" || mock.status === "graded"
          ? "max-w-3xl"
          : "max-w-md",
      )}
    >
      <CardHeader className="px-4">
        <CardTitle>Mock exam</CardTitle>
        <CardDescription className="sr-only">
          A timed exam from your Course
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-4 text-sm">
        {body}
      </CardContent>
    </Card>
  );
}
