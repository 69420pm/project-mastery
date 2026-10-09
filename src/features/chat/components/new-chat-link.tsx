"use client";

import { SquarePenIcon } from "lucide-react";
import { SidebarLink } from "@/components/sidebar-link";
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar";
import { newChatPath } from "@/features/chat/domain/chat-paths";
import { useChatList } from "@/features/chat/hooks/use-chat-list";

/** The sidebar's New chat link, opening an empty Chat in the Course. */
export function NewChatLink() {
  const { courseId } = useChatList();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {/* Never highlighted: an empty Chat is not in the list. */}
        <SidebarLink href={newChatPath(courseId)} isActive={false}>
          <SquarePenIcon />
          <span>New chat</span>
        </SidebarLink>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
