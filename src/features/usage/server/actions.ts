"use server";

import "server-only";
import { getDailyLimitStatus } from "@/features/usage/server/daily-limit";
import type { DailyLimitStatus } from "@/features/usage/types";

/**
 * The signed-in Student's current Daily limit status, for the client to
 * refresh after an AI call has finished. Contains no amounts.
 */
export async function refreshDailyLimitStatus(): Promise<DailyLimitStatus> {
  return getDailyLimitStatus();
}
