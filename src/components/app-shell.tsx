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
  /** Where the page is, in the top bar beside the sidebar toggle. */
  breadcrumb?: ReactNode;
  /** The page. */
  children: ReactNode;
};

/**
 * Shell for signed-in pages: a collapsible sidebar with the logo, which is a
 * slide-over on a phone, next to the page under a top bar.
 */
export function AppShell({
  defaultOpen,
  homeHref,
  header,
  content,
  footer,
  breadcrumb,
  children,
}: AppShellProps) {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <Sidebar>
        <SidebarHeader>
          <SidebarLogoLink href={homeHref} />
          {header}
        </SidebarHeader>
        <SidebarContent>{content}</SidebarContent>
        {footer && <SidebarFooter>{footer}</SidebarFooter>}
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="h-svh min-w-0">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger className="-ml-1" />
          {breadcrumb && (
            <>
              <div aria-hidden className="mr-1 h-4 w-px shrink-0 bg-border" />
              {breadcrumb}
            </>
          )}
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
