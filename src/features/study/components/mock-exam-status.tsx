"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MockExamButton } from "@/features/study/components/mock-exam-button";
import type { MockExamView } from "@/features/study/types";

/** How often the page refreshes while the mock assembles. */
const ASSEMBLY_POLL_MS = 2000;

/**
 * A Mock exam's page before it starts (#185): its assembly's progress,
 * polled; once ready its minutes, item count and aids; once failed the
 * reason and Assemble another.
 */
export function MockExamStatus({ mock }: { mock: MockExamView }) {
  const router = useRouter();
  const assembling = mock.status === "assembling";
  useEffect(() => {
    if (!assembling) return;
    const timer = setInterval(() => router.refresh(), ASSEMBLY_POLL_MS);
    return () => clearInterval(timer);
  }, [assembling, router]);

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
        </>
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
      className="w-full max-w-md gap-3 py-4"
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
