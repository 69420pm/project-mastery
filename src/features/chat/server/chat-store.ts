import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { ChatUIMessage } from "@/features/chat/types";

/**
 * Reads and writes Chats and their messages as the signed-in Student, so Row
 * Level Security applies: another Student's Chat reads as missing.
 */

export type Supabase = SupabaseClient<Database>;

export type StoredChat = {
  id: string;
  title: string | null;
  modelChoice: string;
};

type MessageRow = Database["public"]["Tables"]["chat_messages"]["Row"];

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
    .select("id, title, model_choice")
    .eq("id", chatId)
    .maybeSingle();
  if (error) fail("Loading the Chat", error);
  return data
    ? { id: data.id, title: data.title, modelChoice: data.model_choice }
    : null;
}

/**
 * Creates a Chat owned by the signed-in Student. Returns null when the id is
 * taken, which for the Student means it belongs to someone else.
 */
export async function createChat(
  supabase: Supabase,
  chatId: string,
  modelChoice: string,
): Promise<StoredChat | null> {
  const { data, error } = await supabase
    .from("chats")
    .insert({ id: chatId, model_choice: modelChoice })
    .select("id, title, model_choice")
    .single();
  if (error?.code === "23505") return null;
  if (error) fail("Creating the Chat", error);
  return { id: data.id, title: data.title, modelChoice: data.model_choice };
}

/**
 * Stores the Chat's last model choice. It does not reorder the Chat list,
 * which follows `last_message_at`.
 */
export async function setModelChoice(
  supabase: Supabase,
  chatId: string,
  modelChoice: string,
) {
  const { error } = await supabase
    .from("chats")
    .update({ model_choice: modelChoice })
    .eq("id", chatId);
  if (error) fail("Saving the model choice", error);
}

/**
 * The Student's Chats, newest message first, each with its title and the
 * text of its first message.
 */
export async function listChats(
  supabase: Supabase,
): Promise<
  { id: string; title: string | null; firstMessage: string | null }[]
> {
  const { data, error } = await supabase
    .from("chats")
    .select("id, title, chat_messages(parts)")
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
        ? textOf(first.parts as ChatUIMessage["parts"])
        : null,
    };
  });
}

function textOf(parts: ChatUIMessage["parts"]): string {
  return parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

export async function deleteChat(supabase: Supabase, chatId: string) {
  const { error } = await supabase.from("chats").delete().eq("id", chatId);
  if (error) fail("Deleting the Chat", error);
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

/**
 * Stores a message. Returns false when its id is taken by a message the
 * Student cannot see.
 */
export async function saveMessage(
  supabase: Supabase,
  chatId: string,
  message: ChatUIMessage,
): Promise<boolean> {
  const { error } = await supabase.from("chat_messages").insert({
    id: message.id,
    chat_id: chatId,
    role: message.role,
    parts: message.parts as unknown as Json[],
    model_id: message.metadata?.modelId ?? null,
    stopped: message.metadata?.stopped ?? false,
  });
  if (error?.code === "23505") return false;
  if (error) fail("Saving the message", error);
  return true;
}

export async function deleteMessages(supabase: Supabase, messageIds: string[]) {
  if (messageIds.length === 0) return;
  const { error } = await supabase
    .from("chat_messages")
    .delete()
    .in("id", messageIds);
  if (error) fail("Deleting messages", error);
}
