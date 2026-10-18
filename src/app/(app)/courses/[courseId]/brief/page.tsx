import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Brief, BriefLayout, BriefPanel, briefPath } from "@/features/brief";
import { getBrief } from "@/features/brief/server";
import { getFindings } from "@/features/knowledge-map/server";
import { MemoryCard, StudyPlanFacts } from "@/features/study";
import { getMemory, getPlan } from "@/features/study/server";
import { getDailyLimitStatus } from "@/features/usage/server";
import { requireUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: "Brief",
};

/**
 * A Course's Brief: the conversation in which the AI asks about the exam,
 * beside a panel with the data it holds.
 */
export default async function BriefPage({
  params,
}: PageProps<"/courses/[courseId]/brief">) {
  const { courseId } = await params;
  await requireUser(briefPath(courseId));
  const [brief, dailyLimit, memory, findings, plan] = await Promise.all([
    getBrief(courseId),
    getDailyLimitStatus(),
    getMemory(courseId),
    getFindings(courseId),
    getPlan(courseId),
  ]);
  if (!brief) notFound();

  return (
    <BriefLayout
      conversation={<Brief brief={brief} dailyLimit={dailyLimit} />}
      panel={
        <BriefPanel
          brief={brief}
          findings={findings}
          plan={<StudyPlanFacts plan={plan} />}
          memory={<MemoryCard courseId={courseId} text={memory} />}
        />
      }
    />
  );
}
