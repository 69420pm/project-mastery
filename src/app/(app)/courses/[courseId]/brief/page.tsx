import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Brief, briefPath } from "@/features/brief";
import { getBrief } from "@/features/brief/server";
import { getDailyLimitStatus } from "@/features/usage/server";
import { requireUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: "Brief",
};

/** A Course's Brief: the conversation in which the AI asks about the exam. */
export default async function BriefPage({
  params,
}: PageProps<"/courses/[courseId]/brief">) {
  const { courseId } = await params;
  await requireUser(briefPath(courseId));
  const [brief, dailyLimit] = await Promise.all([
    getBrief(courseId),
    getDailyLimitStatus(),
  ]);
  if (!brief) notFound();

  return <Brief brief={brief} dailyLimit={dailyLimit} />;
}
