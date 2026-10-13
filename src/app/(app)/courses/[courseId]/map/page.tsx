import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCourse } from "@/features/courses/server";
import { KnowledgeMap, knowledgeMapPath } from "@/features/knowledge-map";
import { getKnowledgeMap } from "@/features/knowledge-map/server";
import { requireUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: "Knowledge map",
};

/** A Course's Knowledge map: build it and read its big ideas and KCs. */
export default async function KnowledgeMapPage({
  params,
}: PageProps<"/courses/[courseId]/map">) {
  const { courseId } = await params;
  await requireUser(knowledgeMapPath(courseId));
  const [course, map] = await Promise.all([
    getCourse(courseId),
    getKnowledgeMap(courseId),
  ]);
  if (!course) notFound();

  return <KnowledgeMap map={map} />;
}
