"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { newChatPath } from "@/features/chat/domain/chat-paths";
import {
  attachedMaterialSchema,
  chatIdSchema,
  chatNotFoundMessage,
  deleteChatSchema,
  openSourceSchema,
  renameChatSchema,
  sourceNotFoundMessage,
} from "@/features/chat/schemas";
import type { ChatSource, SourceRequest } from "@/features/chat/types";
import { findChunkSpan } from "@/features/ingestion/server";
import { findReadingSection } from "@/features/knowledge-map/server";
import {
  countChatsAttaching,
  deleteChat as deleteStoredChat,
  findChat,
  renameChat as renameStoredChat,
} from "@/features/chat/server/chat-store";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { parseActionInput, type ActionResult } from "@/lib/validation/action";

const signedOut = { ok: false, message: "Sign in again to continue." } as const;
const chatNotFound = {
  ok: false,
  message: chatNotFoundMessage,
} as const;
const sourceNotFound = { ok: false, message: sourceNotFoundMessage } as const;

/**
 * Renames one of the Student's Chats for good: automatic titling never
 * overwrites it. Refreshes the sidebar.
 */
export async function renameChat(input: {
  chatId: string;
  title: string;
}): Promise<ActionResult> {
  const parsed = parseActionInput(renameChatSchema, input);
  if (!parsed.ok) return parsed;
  if (!(await getUser())) return signedOut;

  const renamed = await renameStoredChat(
    await createClient(),
    parsed.data.chatId,
    parsed.data.title,
  );
  if (!renamed) return chatNotFound;

  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/**
 * The current title of one of the Student's Chats, null while it has none,
 * for the sidebar to show a title generated after the first reply.
 */
export async function getChatTitle(input: {
  chatId: string;
}): Promise<ActionResult<string | null>> {
  const parsed = parseActionInput(chatIdSchema, input);
  if (!parsed.ok) return parsed;
  if (!(await getUser())) return signedOut;

  const chat = await findChat(await createClient(), parsed.data.chatId);
  if (!chat) return chatNotFound;
  return { ok: true, data: chat.title };
}

/**
 * Deletes one of the Student's Chats with its messages, permanently. Its
 * usage records stay, without the Chat reference. Refreshes the sidebar, and
 * with `leave`, as when the Chat is open, lands the Student on a new Chat
 * in its Course.
 */
export async function deleteChat(input: {
  chatId: string;
  leave?: boolean;
}): Promise<ActionResult> {
  const parsed = parseActionInput(deleteChatSchema, input);
  if (!parsed.ok) return parsed;
  if (!(await getUser())) return signedOut;

  const deleted = await deleteStoredChat(
    await createClient(),
    parsed.data.chatId,
  );
  if (!deleted) return chatNotFound;

  revalidatePath("/", "layout");
  if (parsed.data.leave) redirect(newChatPath(deleted.courseId));
  return { ok: true, data: undefined };
}

/**
 * A source of the Course for the source pane, read as the Student: a
 * Reading section's or a cited chunk's Material and pages. A source of another Course, or another Student's, is not found.
 */
export async function openSource(input: {
  courseId: string;
  kind: SourceRequest["kind"];
  id: string;
}): Promise<ActionResult<ChatSource>> {
  const parsed = parseActionInput(openSourceSchema, input);
  if (!parsed.ok) return sourceNotFound;
  if (!(await getUser())) return signedOut;
  const supabase = await createClient();
  const { courseId, kind, id } = parsed.data;

  if (kind === "section") {
    const section = await findReadingSection(supabase, courseId, id);
    if (!section) return sourceNotFound;
    return {
      ok: true,
      data: {
        materialId: section.materialId,
        materialName: section.materialName,
        pageFrom: section.pageFrom,
        pageTo: section.pageTo,
      },
    };
  }
  const chunk = await findChunkSpan(supabase, courseId, id);
  if (!chunk) return sourceNotFound;
  return {
    ok: true,
    data: {
      materialId: chunk.materialId,
      materialName: chunk.materialName,
      pageFrom: chunk.pageFrom,
      pageTo: chunk.pageTo,
    },
  };
}

/**
 * How many of the Student's Chats attach the Material, for the Material's
 * delete confirmation.
 */
export async function countMaterialChats(input: {
  materialId: string;
}): Promise<ActionResult<{ chatCount: number }>> {
  const parsed = parseActionInput(attachedMaterialSchema, input);
  if (!parsed.ok) return parsed;
  if (!(await getUser())) return signedOut;

  const chatCount = await countChatsAttaching(
    await createClient(),
    parsed.data.materialId,
  );
  return { ok: true, data: { chatCount } };
}
