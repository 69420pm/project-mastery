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
