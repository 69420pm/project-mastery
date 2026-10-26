import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chat, newChatPath } from "@/features/chat";
import { newChat } from "@/features/chat/server";
import { getCourse, getMaterialList } from "@/features/courses/server";
import { courseMapPath, topicPath } from "@/features/knowledge-map";
import { parseSessionMode, TodayCard } from "@/features/study";
import { getPlan } from "@/features/study/server";
import { getDailyLimitStatus } from "@/features/usage/server";
import { requireUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: "New chat",
};

/**
 * A new Chat in a Course, whose empty state shows the Today card. It is
 * stored with its first message.
 */
export default async function NewChatPage({
  params,
  searchParams,
}: PageProps<"/courses/[courseId]/chat">) {
  const { courseId } = await params;
  const { mode, mock } = await searchParams;
  const user = await requireUser(newChatPath(courseId));
  const [course, dailyLimit, materials, plan] = await Promise.all([
    getCourse(courseId),
    getDailyLimitStatus(),
    getMaterialList(courseId),
    getPlan(courseId),
  ]);
  if (!course) notFound();
  const chat = newChat(course.id, parseSessionMode(mode), mock);

  return (
    <Chat
      key={chat.id}
      chat={chat}
      isNew
      materials={materials}
      ownerId={user.id}
      emptyState={
        <TodayCard
          plan={plan}
          mapHref={courseMapPath(courseId)}
          topicHref={plan.today.next && topicPath(courseId, plan.today.next.id)}
        />
      }
      dailyLimit={dailyLimit}
    />
  );
}
