"use client";

import { useEffect, useState } from "react";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  dailyLimitPercentLeft,
  loadDailyUsage,
  useLocalResetTime,
  type DailyUsage,
} from "@/features/usage";
import { costText } from "@/lib/ai/cost";

/**
 * Today's Daily limit in Settings. It loads when it mounts, which is when the
 * dialog opens, so the numbers are current.
 */
export function DailyLimitRow() {
  const [usage, setUsage] = useState<DailyUsage>();
  const resetTime = useLocalResetTime(usage?.resetsAt ?? "");

  useEffect(() => {
    let cancelled = false;
    void loadDailyUsage().then((loaded) => {
      if (!cancelled) setUsage(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Field>
      <FieldLabel>Today&apos;s daily limit</FieldLabel>
      {usage === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : usage.limitUsd === undefined ? (
        <p className="text-sm">No daily limit</p>
      ) : (
        <LimitBar
          spentUsd={usage.spentUsd}
          limitUsd={usage.limitUsd}
          resetTime={resetTime}
        />
      )}
    </Field>
  );
}

function LimitBar({
  spentUsd,
  limitUsd,
  resetTime,
}: {
  spentUsd: number;
  limitUsd: number;
  resetTime: string | null;
}) {
  const left = dailyLimitPercentLeft(spentUsd, limitUsd);
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="progressbar"
        aria-label="Daily limit left today"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={left}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full bg-primary" style={{ width: `${left}%` }} />
      </div>
      <p className="text-sm">
        {left}% left today ·{" "}
        {resetTime ? `resets at ${resetTime}` : "resets at midnight UTC"}
      </p>
      <p className="text-xs text-muted-foreground">
        {costText(spentUsd)} of {costText(limitUsd)} used
      </p>
    </div>
  );
}
