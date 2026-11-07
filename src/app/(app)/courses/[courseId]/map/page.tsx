import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { briefPath } from "@/features/brief";
import { getCourse } from "@/features/courses/server";
import { newChatPath } from "@/features/chat";
import { CourseMap, courseMapPath, topicPath } from "@/features/knowledge-map";
import {
  getKnowledgeMap,
  loadCourseTopics,
} from "@/features/knowledge-map/server";
import {
  ExamResultCard,
  mockExamPath,
  ProgressLine,
  ReadinessLine,
  TodayCard,
  topicBadges,
} from "@/features/study";
import {
  getExamToReport,
  getOpenMockExam,
  getStudyState,
} from "@/features/study/server";
import { requireUser } from "@/lib/auth/user";
import { isProductionDeployment } from "@/lib/deployment-env";

export const metadata: Metadata = {
  title: "Course map",
};

/**
 * A Course's home, the Course map: build the Knowledge map and see its
 * nested Topics.
 */
export default async function CourseMapPage({
  params,
}: PageProps<"/courses/[courseId]/map">) {
  const { courseId } = await params;
  await requireUser(courseMapPath(courseId));
  const [course, map, topics, study, openMock, examToReport] =
    await Promise.all([
      getCourse(courseId),
      getKnowledgeMap(courseId),
      loadCourseTopics(courseId),
      getStudyState(courseId),
      getOpenMockExam(courseId),
      getExamToReport(courseId),
    ]);
  if (!course) notFound();

  return (
    <CourseMap
      map={map}
      topics={topics.map(({ id, parentId, name, centralQuestion, kcs }) => ({
        id,
        parentId,
        name,
        centralQuestion,
        kcs,
      }))}
      topicStudies={study.topics}
      progressLine={
        <ProgressLine state={study} briefHref={briefPath(courseId)} />
      }
      readinessLine={<ReadinessLine state={study} />}
      checkDetails={!isProductionDeployment()}
      topicBadges={Object.fromEntries(
        study.scope.map((topic) => [topic.id, topicBadges(topic)]),
      )}
      today={
        <>
          <TodayCard
            state={study}
            mapHref={courseMapPath(courseId)}
            topicHref={(topicId) => topicPath(courseId, topicId)}
            chatHref={newChatPath(courseId)}
            mock={{
              courseId,
              openHref: openMock && mockExamPath(courseId, openMock),
            }}
          />
          {examToReport && (
            <ExamResultCard courseId={courseId} examDate={examToReport} />
          )}
        </>
      }
    />
  );
}
