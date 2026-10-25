"use client";

import { FlagIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { PROBLEM_FLAGS } from "@/features/study/schemas";
import { flagProblem } from "@/features/study/server/actions";
import type { ProblemFlag as Flag } from "@/features/study/types";

const FLAG_NAMES: Record<Flag, string> = {
  unclear: "Unclear",
  wrong: "Wrong",
  too_easy: "Too easy",
  off_topic: "Off topic",
};

/**
 * Flag this problem on a generated Problem's question card (#183): the
 * Student picks one of four reasons, once, and the Problem is not asked
 * again. Shows the flag once it is set.
 */
export function ProblemFlagControl({
  problemId,
  flag: storedFlag,
}: {
  problemId: string;
  /** The stored flag; undefined while the Problem has none. */
  flag: Flag | undefined;
}) {
  const [flag, setFlag] = useState(storedFlag);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (flag) {
    return (
      <p className="flex items-center gap-1.5 text-muted-foreground">
        <FlagIcon className="size-4" />
        Flagged as {FLAG_NAMES[flag].toLowerCase()}: it won&apos;t be asked
        again.
      </p>
    );
  }

  function choose(reason: Flag) {
    startTransition(async () => {
      const result = await flagProblem({ problemId, flag: reason });
      if (result.ok) setFlag(reason);
      else setError(result.message);
    });
  }

  if (!choosing) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="self-start text-muted-foreground"
        onClick={() => setChoosing(true)}
      >
        <FlagIcon />
        Flag this problem
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label="Why flag this problem?"
        className="flex flex-wrap items-center gap-1.5"
      >
        <span className="text-muted-foreground" aria-hidden>
          Why?
        </span>
        {PROBLEM_FLAGS.map((reason) => (
          <Button
            key={reason}
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => choose(reason)}
          >
            {FLAG_NAMES[reason]}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => setChoosing(false)}
        >
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
