import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { materialChunksPath } from "@/features/courses";
import { TopicDetail, topicPath } from "@/features/knowledge-map";
import {
  getKnowledgeMap,
  loadCourseTopics,
} from "@/features/knowledge-map/server";
import { chunkAnchor } from "@/features/ingestion/server";
import { getPriorities } from "@/features/priorities/server";
import { LeftOutBadge } from "@/features/study";
import { getKcLearning, getPlan } from "@/features/study/server";
import { requireUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: "Topic",
};

/**
 * A Topic of the Course map: its detail and the KC graph restricted to it.
 * An unknown Topic, or another Student's, is not found.
 */
export default async function TopicPage({
  params,
}: PageProps<"/courses/[courseId]/map/[topicId]">) {
  const { courseId, topicId } = await params;
  await requireUser(topicPath(courseId, topicId));
  const [map, topics, priorities, learning, plan] = await Promise.all([
    getKnowledgeMap(courseId),
    loadCourseTopics(courseId),
    getPriorities(courseId),
    getKcLearning(courseId),
    getPlan(courseId),
  ]);
  const topic = topics.find(({ id }) => id === topicId);
  if (!topic) notFound();

  return (
    <TopicDetail
      courseId={courseId}
      topic={{
        ...topic,
        readingSections: topic.readingSections.flatMap((section) => {
          const [firstChunk] = section.chunkIds;
          if (!firstChunk) return [];
          const pages =
            section.pageFrom === section.pageTo
              ? `p. ${section.pageFrom}`
              : `pp. ${section.pageFrom}–${section.pageTo}`;
          return {
            label: `${section.materialName}, ${pages}`,
            href: `${materialChunksPath(courseId, section.materialId)}#${chunkAnchor(firstChunk)}`,
          };
        }),
      }}
      topics={topics.map(({ id, bigIdeaId, name, centralQuestion, kcs }) => ({
        id,
        bigIdeaId,
        name,
        centralQuestion,
        kcs,
      }))}
      map={map}
      priorities={priorities}
      learning={learning}
      leftOut={plan.leftOut.map((kc) => kc.id)}
      leftOutBadge={<LeftOutBadge />}
    />
  );
}
