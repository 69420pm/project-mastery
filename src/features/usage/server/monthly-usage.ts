import "server-only";
import {
  monthlyUsage,
  utcMonthStart,
  type MonthlyUsage,
} from "@/features/usage/domain/monthly-usage";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The AI spend since `since` that `supabase` may read: with a session
 * client, Row Level Security keeps it to the Student's own records.
 */
export async function loadMonthlyUsage(
  supabase: Supabase,
  since: Date,
): Promise<MonthlyUsage> {
  const { data, error } = await supabase
    .from("ai_usage")
    .select("task, cost_usd, chats(courses(id, name))")
    .gte("created_at", since.toISOString());
  if (error) throw new Error(`Loading AI usage failed: ${error.message}`);
  return monthlyUsage(
    data.map((row) => ({
      task: row.task,
      costUsd: Number(row.cost_usd),
      course: row.chats?.courses ?? null,
    })),
  );
}

/**
 * The signed-in Student's AI spend this UTC calendar month, for the usage
 * page; undefined when signed out.
 */
export async function getMonthlyUsage(
  now = new Date(),
): Promise<MonthlyUsage | undefined> {
  if (!(await getUser())) return undefined;
  return loadMonthlyUsage(await createClient(), utcMonthStart(now));
}
