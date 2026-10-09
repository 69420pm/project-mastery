import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chat } from "@/features/chat";
import { chatModelOptions, getChat } from "@/features/chat/server";
import { getMaterialList } from "@/features/courses/server";
import { getDailyLimitStatus } from "@/features/usage/server";
import { requireUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: "Chat",
};

/** A stored Chat. One in another Course is not found here. */
export default async function ChatPage({
  params,
}: PageProps<"/courses/[courseId]/chat/[chatId]">) {
  const { courseId, chatId } = await params;
  const user = await requireUser(`/courses/${courseId}/chat/${chatId}`);
  const [chat, dailyLimit, materials] = await Promise.all([
    getChat(courseId, chatId),
    getDailyLimitStatus(),
    getMaterialList(courseId),
  ]);
  if (!chat) notFound();

  return (
    <Chat
      key={chat.id}
      chat={chat}
      isNew={false}
      modelOptions={chatModelOptions()}
      materials={materials}
      ownerId={user.id}
      dailyLimit={dailyLimit}
    />
  );
}
