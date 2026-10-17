import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { briefPath } from "@/features/brief";
import { getCourse } from "@/features/courses/server";
import { KnowledgeMap, knowledgeMapPath } from "@/features/knowledge-map";
import { getKnowledgeMap } from "@/features/knowledge-map/server";
import { ensurePriorities, getPriorities } from "@/features/priorities/server";
import { getKcLearning, getPlan } from "@/features/study/server";
import { requireUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: "Knowledge map",
};

/**
 * A Course's Knowledge map: build it and read its big ideas and KCs with
 * their priorities, which it starts computing when they are stale.
 */
export default async function KnowledgeMapPage({
  params,
}: PageProps<"/courses/[courseId]/map">) {
  const { courseId } = await params;
  await requireUser(knowledgeMapPath(courseId));
  await ensurePriorities(courseId);
  const [course, map, priorities, learning, plan] = await Promise.all([
    getCourse(courseId),
    getKnowledgeMap(courseId),
    getPriorities(courseId),
    getKcLearning(courseId),
    getPlan(courseId),
  ]);
  if (!course) notFound();

  return (
    <KnowledgeMap
      map={map}
      briefHref={briefPath(courseId)}
      priorities={priorities}
      learning={learning}
      plan={{ ...plan, leftOut: plan.leftOut.map((kc) => kc.id) }}
    />
  );
}
