import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chat } from "@/features/chat";
import { chatModelOptions, getChat } from "@/features/chat/server";
import { requireUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: "Chat",
};

export default async function ChatPage({
  params,
}: PageProps<"/chat/[chatId]">) {
  const { chatId } = await params;
  await requireUser(`/chat/${chatId}`);
  const chat = await getChat(chatId);
  if (!chat) notFound();

  return (
    <Chat
      key={chat.id}
      chatId={chat.id}
      initialMessages={chat.messages}
      isNew={false}
      modelOptions={chatModelOptions()}
      initialModelChoice={chat.modelChoice}
    />
  );
}
