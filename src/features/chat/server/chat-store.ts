import "server-only";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/types";
import { messageText } from "@/features/chat/domain/message-text";
import type { ChatUIMessage } from "@/features/chat/types";

/**
 * Reads and writes Chats and their messages as the signed-in Student, so Row
 * Level Security applies: another Student's Chat reads as missing.
 */

export type StoredChat = {
  id: string;
  /** The Course the Chat belongs to. It never moves. */
  courseId: string;
  title: string | null;
  modelChoice: string;
};

type MessageRow = Database["public"]["Tables"]["chat_messages"]["Row"];

function toStoredChat(row: {
  id: string;
  course_id: string;
  title: string | null;
  model_choice: string;
}): StoredChat {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    modelChoice: row.model_choice,
  };
}

function fail(action: string, error: { message: string }): never {
  throw new Error(`${action} failed: ${error.message}`);
}

/** The Student's Chat with this id, or null when it is missing or not theirs. */
export async function findChat(
  supabase: Supabase,
  chatId: string,
): Promise<StoredChat | null> {
  const { data, error } = await supabase
    .from("chats")
    .select("id, course_id, title, model_choice")
    .eq("id", chatId)
    .maybeSingle();
  if (error) fail("Loading the Chat", error);
  return data ? toStoredChat(data) : null;
}

/**
 * Creates a Chat owned by the signed-in Student in their Course `courseId`,
 * with `replyId` as its latest reply (see `startReply`). Refuses with
 * "taken" when the id is taken, which for the Student means it belongs to
 * someone else, and with "no course" when the Course is not (or no longer)
 * theirs.
 */
export async function createChat(
  supabase: Supabase,
  chatId: string,
  {
    courseId,
    modelChoice,
    replyId,
  }: { courseId: string; modelChoice: string; replyId: string },
): Promise<StoredChat | "taken" | "no course"> {
  const { data, error } = await supabase
    .from("chats")
    .insert({
      id: chatId,
      course_id: courseId,
      model_choice: modelChoice,
      latest_reply_id: replyId,
    })
    .select("id, course_id, title, model_choice")
    .single();
  if (error?.code === "23505") return "taken";
  // The insert policy, or the foreign key once the Course is deleted.
  if (error?.code === "42501" || error?.code === "23503") return "no course";
  if (error) fail("Creating the Chat", error);
  return toStoredChat(data);
}

/**
 * Starts a new reply in a Chat: stores the model choice it uses and marks
 * `replyId` as the latest reply, so a reply still ending from an earlier
 * request is not kept (`saveReply`). Call it before storing the Student's
 * message. It does not reorder the Chat list, which follows
 * `last_message_at`.
 */
export async function startReply(
  supabase: Supabase,
  chatId: string,
  { modelChoice, replyId }: { modelChoice: string; replyId: string },
) {
  const { error } = await supabase
    .from("chats")
    .update({ model_choice: modelChoice, latest_reply_id: replyId })
    .eq("id", chatId);
  if (error) fail("Starting the reply", error);
}

/**
 * Stores a generated title, unless the Student has named the Chat
 * themselves.
 */
export async function setGeneratedTitle(
  supabase: Supabase,
  chatId: string,
  title: string,
) {
  const { error } = await supabase
    .from("chats")
    .update({ title })
    .eq("id", chatId)
    .eq("title_set_manually", false);
  if (error) fail("Saving the title", error);
}

/**
 * Renames a Chat for good: automatic titling never overwrites it. Returns
 * false when the Chat is missing or not the Student's.
 */
export async function renameChat(
  supabase: Supabase,
  chatId: string,
  title: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("chats")
    .update({ title, title_set_manually: true })
    .eq("id", chatId)
    .select("id");
  if (error) fail("Renaming the Chat", error);
  return data.length > 0;
}

/**
 * The Student's Chats in a Course, newest message first, each with its title
 * and the text of its first message.
 */
export async function listChats(
  supabase: Supabase,
  courseId: string,
): Promise<
  { id: string; title: string | null; firstMessage: string | null }[]
> {
  const { data, error } = await supabase
    .from("chats")
    .select("id, title, chat_messages(parts)")
    .eq("course_id", courseId)
    .order("last_message_at", { ascending: false })
    .order("created_at", { referencedTable: "chat_messages", ascending: true })
    .limit(1, { referencedTable: "chat_messages" });
  if (error) fail("Listing the Chats", error);
  return data.map((chat) => {
    const first = chat.chat_messages[0];
    return {
      id: chat.id,
      title: chat.title,
      firstMessage: first
        ? messageText(first.parts as ChatUIMessage["parts"])
        : null,
    };
  });
}

/**
 * Deletes a Chat with its messages. Its usage records stay, without the Chat
 * reference. Returns the Course it was in, or null when the Chat is missing
 * or not the Student's.
 */
export async function deleteChat(
  supabase: Supabase,
  chatId: string,
): Promise<{ courseId: string } | null> {
  const { data, error } = await supabase
    .from("chats")
    .delete()
    .eq("id", chatId)
    .select("course_id");
  if (error) fail("Deleting the Chat", error);
  return data[0] ? { courseId: data[0].course_id } : null;
}

function toUIMessage(row: MessageRow): ChatUIMessage {
  const message = {
    id: row.id,
    role: row.role as ChatUIMessage["role"],
    parts: row.parts as unknown as ChatUIMessage["parts"],
  };
  return row.role === "assistant"
    ? {
        ...message,
        metadata: {
          ...(row.model_id && { modelId: row.model_id }),
          ...(row.stopped && { stopped: true }),
        },
      }
    : message;
}

/** A Chat's messages in order. Not validated: run `validateUIMessages` before model calls. */
export async function loadMessages(
  supabase: Supabase,
  chatId: string,
): Promise<ChatUIMessage[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, chat_id, role, parts, model_id, stopped, created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });
  if (error) fail("Loading the messages", error);
  return data.map(toUIMessage);
}

function messageRow(chatId: string, message: ChatUIMessage) {
  return {
    id: message.id,
    chat_id: chatId,
    role: message.role,
    parts: message.parts as unknown as Json[],
    model_id: message.metadata?.modelId ?? null,
    stopped: message.metadata?.stopped ?? false,
  };
}

/**
 * Stores a Student's message. Returns false when its id is taken by a message the
 * Student cannot see.
 */
export async function saveMessage(
  supabase: Supabase,
  chatId: string,
  message: ChatUIMessage,
): Promise<boolean> {
  const { error } = await supabase
    .from("chat_messages")
    .insert(messageRow(chatId, message));
  if (error?.code === "23505") return false;
  if (error) fail("Saving the message", error);
  return true;
}

/**
 * Stores the AI's reply to the Student message `replyTo` and drops the
 * replies it replaces, as when regenerating, so a failed reply keeps the old
 * one. A reply is kept only while it is the Chat's latest (`startReply`): a
 * stopped reply that ends after the Student regenerated it or sent another
 * message is removed again. Each step is a single statement, and in any
 * order concurrent saves can run in, one reply per Student message remains.
 * Returns false when the reply was not kept.
 */
export async function saveReply(
  supabase: Supabase,
  chatId: string,
  replyTo: string,
  reply: ChatUIMessage,
): Promise<boolean> {
  const { data: saved, error } = await supabase
    .from("chat_messages")
    .insert(messageRow(chatId, reply))
    .select("created_at")
    .single();
  if (error?.code === "23505") return false;
  if (error) fail("Saving the reply", error);

  const { data: chat, error: chatError } = await supabase
    .from("chats")
    .select("latest_reply_id")
    .eq("id", chatId)
    .maybeSingle();
  if (chatError) fail("Loading the Chat", chatError);
  if (chat?.latest_reply_id !== reply.id) {
    await deleteMessage(supabase, reply.id);
    return false;
  }

  // Only replies older than this one: a newer one is the latest.
  const { data: studentMessage, error: studentMessageError } = await supabase
    .from("chat_messages")
    .select("created_at")
    .eq("id", replyTo)
    .single();
  if (studentMessageError) {
    fail("Loading the Student's message", studentMessageError);
  }
  const { error: deleteError } = await supabase
    .from("chat_messages")
    .delete()
    .eq("chat_id", chatId)
    .eq("role", "assistant")
    .gt("created_at", studentMessage.created_at)
    .lt("created_at", saved.created_at);
  if (deleteError) fail("Deleting the replaced reply", deleteError);
  return true;
}

async function deleteMessage(supabase: Supabase, messageId: string) {
  const { error } = await supabase
    .from("chat_messages")
    .delete()
    .eq("id", messageId);
  if (error) fail("Deleting the message", error);
}
