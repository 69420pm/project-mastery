"use client";

import { usePathname } from "next/navigation";
import { SidebarLink } from "@/components/sidebar-link";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useChatList } from "@/features/chat/hooks/use-chat-list";
import type { ChatListItem } from "@/features/chat/types";

/**
 * The Student's Chats in the sidebar, newest first, with the open one
 * highlighted. Needs a `ChatListProvider` above it.
 */
export function ChatList() {
  const { chats } = useChatList();
  const pathname = usePathname();

  return (
    <SidebarGroup role="navigation" aria-label="Chats">
      <SidebarGroupLabel>Chats</SidebarGroupLabel>
      <SidebarGroupContent>
        {chats.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">No chats yet.</p>
        ) : (
          <SidebarMenu>
            {chats.map((chat) => (
              <ChatListEntry
                key={chat.id}
                chat={chat}
                isOpen={pathname === `/chat/${chat.id}`}
              />
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * One Chat in the list. Per-Chat actions, such as a "…" menu as a
 * `SidebarMenuAction`, go next to the link.
 */
function ChatListEntry({
  chat,
  isOpen,
}: {
  chat: ChatListItem;
  isOpen: boolean;
}) {
  return (
    <SidebarMenuItem>
      <SidebarLink href={`/chat/${chat.id}`} isActive={isOpen}>
        <span>{chat.label}</span>
      </SidebarLink>
    </SidebarMenuItem>
  );
}
