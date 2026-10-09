import type { ReactNode } from "react";
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

type AppShellProps = {
  /** Whether the sidebar starts open on a desktop, from its cookie. */
  defaultOpen: boolean;
  /** Where the logo leads. */
  homeHref: string;
  /** Shown under the logo, such as navigation links. */
  header?: ReactNode;
  /** The sidebar's scrolling content. */
  content?: ReactNode;
  /** The sidebar's footer, such as the account menu. */
  footer?: ReactNode;
  /** The page. */
  children: ReactNode;
};

/**
 * Shell for signed-in pages: a collapsible sidebar with the logo, which is a
 * slide-over on a phone, next to the page.
 */
export function AppShell({
  defaultOpen,
  homeHref,
  header,
  content,
  footer,
  children,
}: AppShellProps) {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <Sidebar>
        <SidebarHeader>
          <SidebarLogoLink href={homeHref}>Project Mastery</SidebarLogoLink>
          {header}
        </SidebarHeader>
        <SidebarContent>{content}</SidebarContent>
        {footer && <SidebarFooter>{footer}</SidebarFooter>}
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
  );
}
