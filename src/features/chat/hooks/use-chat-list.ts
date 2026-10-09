import { createContext, useContext } from "react";
import type { ChatListItem } from "@/features/chat/types";

export type ChatListContextValue = {
  /** The Course whose Chats these are. */
  courseId: string;
  /** The Student's Chats in the Course, newest message first. */
  chats: ChatListItem[];
  /**
   * Moves a Chat to the top of the list once a message was sent in it, adding
   * it with `chat.label` when the list does not have it yet (a new Chat).
   */
  noteChatActivity: (chat: ChatListItem) => void;
  /** Shows a listed Chat under a new label, such as its new title. */
  relabelChat: (chat: ChatListItem) => void;
};

export const ChatListContext = createContext<ChatListContextValue>({
  courseId: "",
  chats: [],
  noteChatActivity: () => {},
  relabelChat: () => {},
});

/** The sidebar's Chat list, from the nearest `ChatListProvider`. */
export function useChatList() {
  return useContext(ChatListContext);
}

/** `chats` with `chat` moved or added to the top, keeping a listed label. */
export function withChatOnTop(
  chats: ChatListItem[],
  chat: ChatListItem,
): ChatListItem[] {
  if (chats[0]?.id === chat.id) return chats;
  const listed = chats.find(({ id }) => id === chat.id);
  return [listed ?? chat, ...chats.filter(({ id }) => id !== chat.id)];
}

/** `chats` with the listed `chat` shown under its new label. */
export function withChatLabel(
  chats: ChatListItem[],
  chat: ChatListItem,
): ChatListItem[] {
  return chats.map((listed) => (listed.id === chat.id ? chat : listed));
}
