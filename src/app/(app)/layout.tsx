import { cookies } from "next/headers";
import { SidebarLogoLink } from "@/components/sidebar-logo-link";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { UserMenu } from "@/features/auth";
import { ChatList, ChatListProvider, NewChatLink } from "@/features/chat";
import { getChatList } from "@/features/chat/server";
import { getUser } from "@/lib/auth/user";
import { isSidebarOpen } from "@/lib/sidebar-state";

/**
 * Shell for signed-in pages: a collapsible sidebar with the logo, which
 * leads to the Course list, New chat, the Student's Chats and the account
 * menu, a slide-over on a
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
  const sidebarOpen = isSidebarOpen(cookieStore);

  return (
    <ChatListProvider chats={chats}>
      <SidebarProvider defaultOpen={sidebarOpen}>
        <Sidebar>
          <SidebarHeader>
            <SidebarLogoLink href="/courses">Project Mastery</SidebarLogoLink>
            <NewChatLink />
          </SidebarHeader>
          <SidebarContent>
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
