import "server-only";
import {
  dailyLimitLevel,
  dailyLimitReset,
  utcDayStart,
} from "@/features/usage/domain/daily-limit";
import { getDailyLimitUsd } from "@/features/usage/server/daily-limit-env";
import {
  assertStudentScope,
  spentSinceUsd,
  type AdminStudentScope,
  type StudentScope,
} from "@/features/usage/server/usage-store";
import type { DailyLimitStatus } from "@/features/usage/types";
import { createClient } from "@/lib/supabase/server";
import type {
  AdminSupabase,
  SessionSupabase,
  Supabase,
} from "@/lib/supabase/types";

/** The refusal a Student sees when an AI call is refused at the Daily limit. */
export const dailyLimitReachedMessage =
  "You've reached today's daily limit. The AI is available again after it resets.";

/**
 * The signed-in Student's Daily limit status, or that of `studentId` when
 * given (for workflows on the admin client): their AI spend since 00:00 UTC
 * against `AI_DAILY_LIMIT_USD`. Run it before every AI call and refuse the
 * call when the level is `reached`; a call that has started always finishes.
 * Throws for the admin client without a Student id, even with no limit set.
 */
export async function checkDailyLimit(
  supabase: AdminSupabase,
  options: AdminStudentScope & { now?: Date },
): Promise<DailyLimitStatus>;
export async function checkDailyLimit(
  supabase: SessionSupabase,
  options?: StudentScope & { now?: Date },
): Promise<DailyLimitStatus>;
export async function checkDailyLimit(
  supabase: Supabase,
  { studentId, now = new Date() }: StudentScope & { now?: Date } = {},
): Promise<DailyLimitStatus> {
  assertStudentScope(supabase, { studentId });
  const limitUsd = getDailyLimitUsd();
  const resetsAt = dailyLimitReset(now).toISOString();
  if (limitUsd === undefined) return { level: "ok", resetsAt };

  const spentUsd = await spentSinceUsd(supabase, utcDayStart(now), {
    studentId,
  });
  return { level: dailyLimitLevel(spentUsd, limitUsd), resetsAt };
}

/** The signed-in Student's Daily limit status, for pages. */
export async function getDailyLimitStatus(): Promise<DailyLimitStatus> {
  return checkDailyLimit(await createClient());
}
