import "server-only";
import { dailyLimitLevel } from "@/features/usage/domain/daily-limit";
import {
  spentSinceUsd,
  type Supabase,
} from "@/features/usage/server/usage-store";
import type { DailyLimitStatus } from "@/features/usage/types";
import { dailyLimitReset, utcDayStart } from "@/lib/ai/cost";
import { getDailyLimitUsd } from "@/lib/ai/env";
import { createClient } from "@/lib/supabase/server";

/** The refusal a Student sees when an AI call is refused at the Daily limit. */
export const dailyLimitReachedMessage =
  "You've reached today's daily limit. The AI is available again after it resets.";

/**
 * The signed-in Student's Daily limit status:their AI spend since 00:00 UTC
 * against `AI_DAILY_LIMIT_USD`. Run it before every AI call and refuse the
 * call when the level is `reached`; a call that has started always finishes.
 */
export async function checkDailyLimit(
  supabase: Supabase,
  now: Date = new Date(),
): Promise<DailyLimitStatus> {
  const limitUsd = getDailyLimitUsd();
  const resetsAt = dailyLimitReset(now).toISOString();
  if (limitUsd === undefined) return { level: "ok", resetsAt };

  const spentUsd = await spentSinceUsd(supabase, utcDayStart(now));
  return { level: dailyLimitLevel(spentUsd, limitUsd), resetsAt };
}

/** The signed-in Student's Daily limit status, for pages. */
export async function getDailyLimitStatus(): Promise<DailyLimitStatus> {
  return checkDailyLimit(await createClient());
}
