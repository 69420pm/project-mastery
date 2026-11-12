/**
 * How much of today's Daily limit a Student has used, without amounts: the
 * Chat only ever gets this level. The amounts are `DailyUsage`, for Settings.
 *
 * - `ok`: below 80%, or no limit is set
 * - `warning`: from 80%, the Chat shows a notice
 * - `reached`: 100%, AI calls are refused until the reset
 */
export type DailyUsage = {
  /** Today's AI spend in US dollars, since 00:00 UTC. */
  spentUsd: number;
  /** The Daily limit in US dollars, or undefined for no limit. */
  limitUsd: number | undefined;
  /** When the Daily limit resets: the next 00:00 UTC, as an ISO timestamp. */
  resetsAt: string;
};

export type DailyLimitStatus = {
  level: "ok" | "warning" | "reached";
  /** When the Daily limit resets: the next 00:00 UTC, as an ISO timestamp. */
  resetsAt: string;
};
