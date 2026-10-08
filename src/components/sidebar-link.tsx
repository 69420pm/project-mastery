"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";

type SidebarLinkProps = {
  href: string;
  /** Whether the link is the current page. Defaults to an exact path match. */
  isActive?: boolean;
  children: ReactNode;
};

/**
 * A link in the app sidebar, inside a `SidebarMenuItem`. It marks the current
 * page and closes the sidebar's slide-over on a phone once followed. Put the
 * text last in a `<span>` so a long one is truncated.
 */
export function SidebarLink({ href, isActive, children }: SidebarLinkProps) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const active = isActive ?? pathname === href;

  return (
    <SidebarMenuButton asChild isActive={active}>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        onClick={() => {
          if (isMobile) setOpenMobile(false);
        }}
      >
        {children}
      </Link>
    </SidebarMenuButton>
  );
}
