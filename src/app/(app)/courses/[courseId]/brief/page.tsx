import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Brief, BriefPanel, briefPath } from "@/features/brief";
import { getBrief } from "@/features/brief/server";
import { getFindings } from "@/features/knowledge-map/server";
import { MemoryCard } from "@/features/study";
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
    // Narrow screens stack the panel below the conversation and scroll the
    // page; the Sheet that replaces this comes with the narrow layout.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-visible">
      <div className="flex min-h-[32rem] min-w-0 flex-1 flex-col pt-4 lg:min-h-0">
        <Brief brief={brief} dailyLimit={dailyLimit} />
      </div>
      <aside
        aria-label="Brief data"
        className="shrink-0 border-t lg:sticky lg:top-0 lg:h-full lg:w-96 lg:overflow-y-auto lg:border-t-0 lg:border-l"
      >
        <BriefPanel
          brief={brief}
          findings={findings}
          plan={plan}
          memory={<MemoryCard courseId={courseId} text={memory} />}
        />
      </aside>
    </div>
  );
}
