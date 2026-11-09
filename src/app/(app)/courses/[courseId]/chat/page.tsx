import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chat, newChatPath } from "@/features/chat";
import { newChat } from "@/features/chat/server";
import { getCourse, getMaterialList } from "@/features/courses/server";
import { courseMapPath, topicPath } from "@/features/knowledge-map";
import {
  isTodayMessage,
  MOCK_REVIEW_MESSAGE,
  TodayCard,
} from "@/features/study";
import { getStudyState } from "@/features/study/server";
import { getDailyLimitStatus } from "@/features/usage/server";
import { requireUser } from "@/lib/auth/user";
import { isProductionDeployment } from "@/lib/deployment-env";

export const metadata: Metadata = {
  title: "New chat",
};

/**
 * A new Chat in a Course, whose empty state shows the Today card. It is
 * stored with its first message. With `?say=` naming one of the Today
 * card's first messages, it sends that message as the Student at once.
 * With `?mock=` naming a graded Mock exam, its session goes through that
 * mock, and it starts at once.
 */
export default async function NewChatPage({
  params,
  searchParams,
}: PageProps<"/courses/[courseId]/chat">) {
  const { courseId } = await params;
  const { say, mock } = await searchParams;
  // The server checks it is the Student's graded mock of this Course.
  const mockId = typeof mock === "string" ? mock : undefined;
  const user = await requireUser(newChatPath(courseId));
  const [course, dailyLimit, materials, study] = await Promise.all([
    getCourse(courseId),
    getDailyLimitStatus(),
    getMaterialList(courseId),
    getStudyState(courseId),
  ]);
  if (!course) notFound();
  const chat = newChat(course.id);

  return (
    <Chat
      key={chat.id}
      chat={chat}
      isNew
      materials={materials}
      ownerId={user.id}
      initialMessage={
        mockId ? MOCK_REVIEW_MESSAGE : isTodayMessage(say) ? say : undefined
      }
      mockId={mockId}
      emptyState={
        <TodayCard
          state={study}
          mapHref={courseMapPath(courseId)}
          topicHref={(topicId) => topicPath(courseId, topicId)}
          chatHref={newChatPath(courseId)}
        />
      }
      dailyLimit={dailyLimit}
      showDetails={!isProductionDeployment()}
    />
  );
}
