"use client";

import { usePathname } from "next/navigation";
import { chatPath } from "@/features/chat/domain/chat-paths";
import { useChatList } from "@/features/chat/hooks/use-chat-list";

/**
 * The open Chat's label as the sidebar lists it, for the top bar's
 * breadcrumb. Needs a `ChatListProvider` above it.
 */
export function ChatTitle() {
  const { courseId, chats } = useChatList();
  const pathname = usePathname();
  const chat = chats.find(({ id }) => chatPath(courseId, id) === pathname);

  return chat?.label ?? "Chat";
}
