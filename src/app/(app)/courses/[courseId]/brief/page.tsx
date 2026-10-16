import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Brief, briefPath } from "@/features/brief";
import { getBrief } from "@/features/brief/server";
import { MemoryCard } from "@/features/study";
import { getMemory } from "@/features/study/server";
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
  const [brief, dailyLimit, memory] = await Promise.all([
    getBrief(courseId),
    getDailyLimitStatus(),
    getMemory(courseId),
  ]);
  if (!brief) notFound();

  return (
    <>
      <div className="mx-auto w-full max-w-3xl px-4 pt-4">
        <MemoryCard courseId={courseId} text={memory} />
      </div>
      <Brief brief={brief} dailyLimit={dailyLimit} />
    </>
  );
}
