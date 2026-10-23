import type { Metadata } from "next";
import { MonthlyUsageView } from "@/features/usage";
import { getMonthlyUsage } from "@/features/usage/server";
import { requireUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: "AI usage",
};

/** The Student's AI spend this UTC month against the credit's parts. */
export default async function UsagePage() {
  await requireUser("/usage");
  const now = new Date();
  const usage = await getMonthlyUsage(now);
  if (!usage) return null;
  const month = now.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return <MonthlyUsageView usage={usage} month={month} />;
}
