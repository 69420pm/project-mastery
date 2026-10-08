"use client";

import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { SidebarLink } from "@/components/sidebar-link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { DeleteChatDialog } from "@/features/chat/components/delete-chat-dialog";
import { RenameChatDialog } from "@/features/chat/components/rename-chat-dialog";
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

/** One Chat in the list, with its "…" menu to rename or delete it. */
function ChatListEntry({
  chat,
  isOpen,
}: {
  chat: ChatListItem;
  isOpen: boolean;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);

  return (
    <SidebarMenuItem>
      <SidebarLink href={`/chat/${chat.id}`} isActive={isOpen}>
        <span>{chat.label}</span>
      </SidebarLink>
      {/* Not modal, so focus moves cleanly into a dialog opened from it. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label="Chat actions">
            <MoreHorizontalIcon />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={isMobile ? "bottom" : "right"}
          align={isMobile ? "end" : "start"}
        >
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => setDialog("rename")}>
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDialog("delete")}
            >
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameChatDialog
        chat={chat}
        open={dialog === "rename"}
        onOpenChange={(open) => setDialog(open ? "rename" : null)}
      />
      <DeleteChatDialog
        chat={chat}
        open={dialog === "delete"}
        onOpenChange={(open) => setDialog(open ? "delete" : null)}
        isOpen={isOpen}
        // The Student lands on a new Chat, without the slide-over.
        onLeave={() => setOpenMobile(false)}
      />
    </SidebarMenuItem>
  );
}
