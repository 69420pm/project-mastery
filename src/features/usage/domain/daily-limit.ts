import type { DailyLimitStatus } from "@/features/usage/types";

/** The share of the Daily limit from which the Chat warns the Student. */
export const DAILY_LIMIT_WARNING_SHARE = 0.8;

/**
 * How much of the Daily limit today's spend uses. Without a limit, nothing
 * is ever blocked.
 */
export function dailyLimitLevel(
  spentUsd: number,
  limitUsd: number | undefined,
): DailyLimitStatus["level"] {
  if (limitUsd === undefined) return "ok";
  if (spentUsd >= limitUsd) return "reached";
  if (spentUsd >= limitUsd * DAILY_LIMIT_WARNING_SHARE) return "warning";
  return "ok";
}

/** Start of the current Daily limit window: 00:00 UTC of `now`'s day. */
export function utcDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** When the Daily limit resets: the next 00:00 UTC after `now`. */
export function dailyLimitReset(now: Date): Date {
  const start = utcDayStart(now);
  return new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate() + 1,
    ),
  );
}
