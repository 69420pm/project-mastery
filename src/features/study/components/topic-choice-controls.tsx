"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_SKIP_REASON_LENGTH } from "@/features/study/schemas";
import { setTopicChoice } from "@/features/study/server/actions";

/**
 * Pin and Skip on a Topic's page. `choice` is the Student's current one;
 * choosing the other replaces it, and Unpin or Unskip clears it. A skip
 * takes an optional reason for the AI's Memory, which the page says it
 * didn't keep when the Memory is full.
 */
export function TopicChoiceControls({
  courseId,
  topicId,
  choice,
}: {
  courseId: string;
  topicId: string;
  choice: "pinned" | "skipped" | null;
}) {
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<
    { kind: "reason-lost" } | { kind: "error"; message: string } | null
  >(null);
  const [isPending, startTransition] = useTransition();

  function choose(next: "pinned" | "skipped" | null) {
    startTransition(async () => {
      const result = await setTopicChoice({
        courseId,
        topicId,
        choice: next,
        reason: next === "skipped" ? reason : undefined,
      });
      if (!result.ok) {
        setStatus({ kind: "error", message: result.message });
        return;
      }
      setReason("");
      setStatus(result.data.reasonKept ? null : { kind: "reason-lost" });
    });
  }

  return (
    <div className="flex max-w-xl flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => choose(choice === "pinned" ? null : "pinned")}
        >
          {choice === "pinned" ? "Unpin" : "Pin"}
        </Button>
        {choice === "skipped" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => choose(null)}
          >
            Unskip
          </Button>
        ) : (
          <>
            <Input
              aria-label="Reason for skipping (optional)"
              placeholder="Reason for skipping (optional)"
              value={reason}
              maxLength={MAX_SKIP_REASON_LENGTH}
              className="h-8 max-w-64"
              onChange={(event) => setReason(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => choose("skipped")}
            >
              Skip
            </Button>
          </>
        )}
      </div>
      {status?.kind === "reason-lost" && (
        <p role="status" className="text-sm text-muted-foreground">
          Skipped. Your reason wasn&apos;t kept: the Memory is full.
        </p>
      )}
      {status?.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {status.message}
        </p>
      )}
    </div>
  );
}
