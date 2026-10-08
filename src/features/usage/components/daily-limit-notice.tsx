"use client";

import { CircleAlertIcon, ClockIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { DailyLimitStatus } from "@/features/usage/types";

const subscribeToNothing = () => () => {};

/**
 * The reset time in the Student's local time. The server does not know the
 * Student's time zone, so it renders a neutral text that the browser
 * replaces after hydration.
 */
function useLocalResetTime(resetsAt: string): string | null {
  return useSyncExternalStore(
    subscribeToNothing,
    () =>
      new Date(resetsAt).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }),
    () => null,
  );
}

/**
 * Tells the Student how much of today's Daily limit is left, without amounts:
 * a notice from 80%, and when the limit resets once it is reached. Shows
 * nothing below 80%.
 */
export function DailyLimitNotice({ status }: { status: DailyLimitStatus }) {
  const resetTime = useLocalResetTime(status.resetsAt);

  if (status.level === "ok") return null;
  if (status.level === "warning") {
    return (
      <Alert>
        <CircleAlertIcon />
        <AlertDescription>
          You&apos;ve used most of today&apos;s daily limit.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert>
      <ClockIcon />
      <AlertDescription>
        {resetTime
          ? `You've reached today's daily limit. It resets at ${resetTime}.`
          : "You've reached today's daily limit. It resets at midnight UTC."}
      </AlertDescription>
    </Alert>
  );
}
