import "server-only";
import { z } from "zod";
import { offeredModelChoice } from "@/features/chat/ai/reply";
import { chatLabel } from "@/features/chat/domain/chat-label";
import {
  findChat,
  listChats,
  loadMessages,
} from "@/features/chat/server/chat-store";
import type { ChatListItem, ChatWithMessages } from "@/features/chat/types";
import { getUser, requireUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in Student's Chat with its messages in order, or null when the
 * id is malformed, unknown or another Student's Chat (show not-found).
 */
export async function getChat(
  chatId: string,
): Promise<ChatWithMessages | null> {
  await requireUser(`/chat/${chatId}`);
  if (!z.uuid().safeParse(chatId).success) return null;

  const supabase = await createClient();
  const chat = await findChat(supabase, chatId);
  if (!chat) return null;
  return {
    id: chat.id,
    title: chat.title,
    modelChoice: offeredModelChoice(chat.modelChoice),
    messages: await loadMessages(supabase, chat.id),
  };
}

/**
 * The signed-in Student's Chats for the sidebar, newest message first. Empty
 * when signed out, without redirecting: the layout that shows the list only
 * reads the user, and each page guards itself.
 */
export async function getChatList(): Promise<ChatListItem[]> {
  if (!(await getUser())) return [];
  const chats = await listChats(await createClient());
  return chats.map((chat) => ({ id: chat.id, label: chatLabel(chat) }));
}
