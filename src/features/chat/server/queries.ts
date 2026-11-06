import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { chatLabel } from "@/features/chat/domain/chat-label";
import { chatPath } from "@/features/chat/domain/chat-paths";
import {
  findChat,
  listChats,
  loadMessages,
} from "@/features/chat/server/chat-store";
import type { ChatListItem, ChatWithMessages } from "@/features/chat/types";
import { getSessionEnd } from "@/features/study/server";
import { getUser, requireUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in Student's Chat in a Course with its messages in order, or
 * null when an id is malformed, the Chat is unknown, another Student's or in
 * another Course (show not-found).
 */
export async function getChat(
  courseId: string,
  chatId: string,
): Promise<ChatWithMessages | null> {
  await requireUser(chatPath(courseId, chatId));
  if (!z.uuid().safeParse(chatId).success) return null;

  const supabase = await createClient();
  const chat = await findChat(supabase, chatId);
  if (chat?.courseId !== courseId) return null;
  const [messages, end] = await Promise.all([
    loadMessages(supabase, chat.id),
    getSessionEnd(supabase, chat.id),
  ]);
  return {
    id: chat.id,
    courseId: chat.courseId,
    title: chat.title,
    messages,
    ended: end !== null,
  };
}

/**
 * An unsaved Chat in a Course for the new Chat page. It is stored with its
 * first message, under this id.
 */
export function newChat(courseId: string): ChatWithMessages {
  return {
    id: randomUUID(),
    courseId,
    title: null,
    messages: [],
    ended: false,
  };
}

/**
 * The signed-in Student's Chats in a Course for the sidebar, newest message
 * first. Empty when signed out, without redirecting: the layout that shows
 * the list only reads the user, and each page guards itself.
 */
export async function getChatList(courseId: string): Promise<ChatListItem[]> {
  if (!z.uuid().safeParse(courseId).success) return [];
  if (!(await getUser())) return [];
  const chats = await listChats(await createClient(), courseId);
  return chats.map((chat) => ({ id: chat.id, label: chatLabel(chat) }));
}
