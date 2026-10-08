import "server-only";
import { z } from "zod";
import { findChat, loadMessages } from "@/features/chat/server/chat-store";
import type { ChatWithMessages } from "@/features/chat/types";
import { requireUser } from "@/lib/auth/user";
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
    modelChoice: chat.modelChoice,
    messages: await loadMessages(supabase, chat.id),
  };
}
