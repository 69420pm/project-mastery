import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { Chat } from "@/features/chat";
import { chatModelOptions } from "@/features/chat/server";
import { getDailyLimitStatus } from "@/features/usage/server";
import { requireUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: "New chat",
};

/** A new Chat. It is stored with its first message, under this id. */
export default async function NewChatPage() {
  await requireUser("/chat");
  const chatId = randomUUID();
  const dailyLimit = await getDailyLimitStatus();

  return (
    <Chat
      key={chatId}
      chatId={chatId}
      initialMessages={[]}
      isNew
      modelOptions={chatModelOptions()}
      dailyLimit={dailyLimit}
    />
  );
}
