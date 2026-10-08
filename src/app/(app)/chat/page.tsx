import type { Metadata } from "next";
import { Chat } from "@/features/chat";
import { chatModelOptions, newChat } from "@/features/chat/server";
import { getDailyLimitStatus } from "@/features/usage/server";
import { requireUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: "New chat",
};

/** A new Chat. It is stored with its first message. */
export default async function NewChatPage() {
  await requireUser("/chat");
  const chat = newChat();
  const dailyLimit = await getDailyLimitStatus();

  return (
    <Chat
      key={chat.id}
      chat={chat}
      isNew
      modelOptions={chatModelOptions()}
      dailyLimit={dailyLimit}
    />
  );
}
