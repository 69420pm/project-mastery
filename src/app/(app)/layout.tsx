import { LayoutDashboardIcon } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { SidebarLink } from "@/components/sidebar-link";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { UserMenu } from "@/features/auth";
import { ChatList, ChatListProvider, NewChatLink } from "@/features/chat";
import { getChatList } from "@/features/chat/server";
import { getUser } from "@/lib/auth/user";

/**
 * Shell for signed-in pages: a collapsible sidebar with New chat, the
 * Student's Chats, the dashboard and the account menu, a slide-over on a
 * phone. It only reads the user: each page calls `requireUser` with its own
 * path, so signing in returns there. Layouts also do not re-render on client
 * navigation, so they cannot guard pages.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const [user, chats, cookieStore] = await Promise.all([
    getUser(),
    getChatList(),
    cookies(),
  ]);
  // The Sidebar stores whether it is open in this cookie.
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <ChatListProvider chats={chats}>
      <SidebarProvider defaultOpen={sidebarOpen}>
        <Sidebar>
          <SidebarHeader>
            <Link
              href="/chat"
              className="px-2 py-1.5 font-semibold tracking-tight"
            >
              Project Mastery
            </Link>
            <NewChatLink />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarLink href="/dashboard">
                    <LayoutDashboardIcon />
                    <span>Dashboard</span>
                  </SidebarLink>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
            <ChatList />
          </SidebarContent>
          {user && (
            <SidebarFooter>
              <UserMenu email={user.email} />
            </SidebarFooter>
          )}
          <SidebarRail />
        </Sidebar>
        <SidebarInset className="h-svh min-w-0">
          <div className="flex h-12 shrink-0 items-center px-2">
            <SidebarTrigger />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </ChatListProvider>
  );
}
