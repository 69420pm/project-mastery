"use server";

import "server-only";
import {
  getDailyLimitStatus,
  getDailyUsage,
} from "@/features/usage/server/daily-limit";
import type { DailyLimitStatus, DailyUsage } from "@/features/usage/types";
import { requireUser } from "@/lib/auth/user";

/** The signed-in Student's spend today with amounts, for Settings. */
export async function loadDailyUsage(): Promise<DailyUsage> {
  await requireUser();
  return getDailyUsage();
}

/**
 * The signed-in Student's current Daily limit status, for the client to
 * refresh after an AI call has finished. Contains no amounts.
 */
export async function refreshDailyLimitStatus(): Promise<DailyLimitStatus> {
  await requireUser();
  return getDailyLimitStatus();
}
