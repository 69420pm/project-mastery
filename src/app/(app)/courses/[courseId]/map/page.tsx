import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { briefPath } from "@/features/brief";
import { getCourse } from "@/features/courses/server";
import { CourseMap, courseMapPath } from "@/features/knowledge-map";
import {
  getKnowledgeMap,
  loadCourseTopics,
} from "@/features/knowledge-map/server";
import { ensurePriorities, getPriorities } from "@/features/priorities/server";
import { PlanLine } from "@/features/study";
import {
  getKcLearning,
  getPlan,
  getTopicProgress,
} from "@/features/study/server";
import { requireUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: "Course map",
};

/**
 * A Course's home, the Course map: build the Knowledge map and see its
 * Topics on its Big ideas. It starts computing the Priorities when they are
 * stale.
 */
export default async function CourseMapPage({
  params,
}: PageProps<"/courses/[courseId]/map">) {
  const { courseId } = await params;
  await requireUser(courseMapPath(courseId));
  await ensurePriorities(courseId);
  const [course, map, topics, priorities, learning, progress, plan] =
    await Promise.all([
      getCourse(courseId),
      getKnowledgeMap(courseId),
      loadCourseTopics(courseId),
      getPriorities(courseId),
      getKcLearning(courseId),
      getTopicProgress(courseId),
      getPlan(courseId),
    ]);
  if (!course) notFound();

  return (
    <CourseMap
      map={map}
      topics={topics.map(({ id, bigIdeaId, name, centralQuestion, kcs }) => ({
        id,
        bigIdeaId,
        name,
        centralQuestion,
        kcs,
      }))}
      priorities={priorities}
      learning={learning}
      progress={progress}
      planLine={<PlanLine plan={plan} briefHref={briefPath(courseId)} />}
    />
  );
}
