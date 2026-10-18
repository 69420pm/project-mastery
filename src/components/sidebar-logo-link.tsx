"use client";

import Link from "next/link";
import { Logo } from "@/components/logo";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * The logo link in the app sidebar's header. Like `SidebarLink`, it closes
 * the sidebar's slide-over on a phone once followed.
 */
export function SidebarLogoLink({ href }: { href: string }) {
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <Link
      href={href}
      className="rounded-md px-2 py-2 outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      onClick={() => {
        if (isMobile) setOpenMobile(false);
      }}
    >
      <Logo />
    </Link>
  );
}
