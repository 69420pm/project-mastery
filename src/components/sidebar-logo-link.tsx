"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * The logo link in the app sidebar's header. Like `SidebarLink`, it closes
 * the sidebar's slide-over on a phone once followed.
 */
export function SidebarLogoLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <Link
      href={href}
      className="px-2 py-1.5 font-semibold tracking-tight"
      onClick={() => {
        if (isMobile) setOpenMobile(false);
      }}
    >
      {children}
    </Link>
  );
}
