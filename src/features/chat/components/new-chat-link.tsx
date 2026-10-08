"use client";

import { SquarePenIcon } from "lucide-react";
import { SidebarLink } from "@/components/sidebar-link";
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar";

/** The sidebar's New chat link, opening an empty Chat at `/chat`. */
export function NewChatLink() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {/* Never highlighted: an empty Chat is not in the list. */}
        <SidebarLink href="/chat" isActive={false}>
          <SquarePenIcon />
          <span>New chat</span>
        </SidebarLink>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
