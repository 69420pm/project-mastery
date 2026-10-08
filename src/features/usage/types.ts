/**
 * How much of today's Daily limit a Student has used, without amounts: no
 * dollar amount ever reaches the Student.
 *
 * - `ok`: below 80%, or no limit is set
 * - `warning`: from 80%, the Chat shows a notice
 * - `reached`: 100%, AI calls are refused until the reset
 */
export type DailyLimitStatus = {
  level: "ok" | "warning" | "reached";
  /** When the Daily limit resets: the next 00:00 UTC, as an ISO timestamp. */
  resetsAt: string;
};
