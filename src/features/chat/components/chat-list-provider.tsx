"use client";

import { type ReactNode, useCallback, useMemo, useState } from "react";
import {
  ChatListContext,
  withChatLabel,
  withChatOnTop,
} from "@/features/chat/hooks/use-chat-list";
import type { ChatListItem } from "@/features/chat/types";

type ChatListProviderProps = {
  /** The stored Chats from `getChatList`. */
  chats: ChatListItem[];
  children: ReactNode;
};

/**
 * Holds the sidebar's Chat list for the signed-in layout. The layout is not
 * re-rendered on client navigation, so a Chat that gets a message is moved to
 * the top here, without reloading. A fresh list from the server, after a
 * refresh or a revalidating Server Action, replaces these local changes.
 */
export function ChatListProvider({ chats, children }: ChatListProviderProps) {
  const [list, setList] = useState({ stored: chats, shown: chats });
  if (list.stored !== chats) setList({ stored: chats, shown: chats });

  const noteChatActivity = useCallback((chat: ChatListItem) => {
    setList((current) => {
      const shown = withChatOnTop(current.shown, chat);
      return shown === current.shown ? current : { ...current, shown };
    });
  }, []);

  const relabelChat = useCallback((chat: ChatListItem) => {
    setList((current) => ({
      ...current,
      shown: withChatLabel(current.shown, chat),
    }));
  }, []);

  const value = useMemo(
    () => ({ chats: list.shown, noteChatActivity, relabelChat }),
    [list.shown, noteChatActivity, relabelChat],
  );

  return <ChatListContext value={value}>{children}</ChatListContext>;
}
