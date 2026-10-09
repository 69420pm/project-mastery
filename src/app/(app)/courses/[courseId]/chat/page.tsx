import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chat } from "@/features/chat";
import { chatModelOptions, newChat } from "@/features/chat/server";
import { getCourse, getMaterialList } from "@/features/courses/server";
import { getDailyLimitStatus } from "@/features/usage/server";
import { requireUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: "New chat",
};

/** A new Chat in a Course. It is stored with its first message. */
export default async function NewChatPage({
  params,
}: PageProps<"/courses/[courseId]/chat">) {
  const { courseId } = await params;
  const user = await requireUser(`/courses/${courseId}/chat`);
  const [course, dailyLimit, materials] = await Promise.all([
    getCourse(courseId),
    getDailyLimitStatus(),
    getMaterialList(courseId),
  ]);
  if (!course) notFound();
  const chat = newChat(course.id);

  return (
    <Chat
      key={chat.id}
      chat={chat}
      isNew
      modelOptions={chatModelOptions()}
      materials={materials}
      ownerId={user.id}
      dailyLimit={dailyLimit}
    />
  );
}
