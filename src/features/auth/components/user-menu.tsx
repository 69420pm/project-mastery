"use client";

import { ChevronsUpDownIcon, LogOutIcon, SettingsIcon } from "lucide-react";
import { startTransition } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useOpenSettings } from "@/features/auth/components/settings-provider";
import { signOut } from "@/features/auth/server/actions";

type UserMenuProps = {
  email: string | undefined;
  /** The Student's name, or null while none is set. */
  displayName: string | null;
};

/**
 * The account menu at the bottom of the app sidebar: the signed-in Student's
 * avatar and name (their email while no name is set), opening a menu with
 * settings and sign-out.
 */
export function UserMenu({ email, displayName }: UserMenuProps) {
  const { isMobile } = useSidebar();
  const openSettings = useOpenSettings();
  const label = displayName || email;
  const initial = label?.charAt(0).toUpperCase() || "?";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" aria-label="Account menu">
              <Avatar className="size-8">
                <AvatarFallback>{initial}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <ChevronsUpDownIcon />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? "top" : "right"}
            align="end"
            className="min-w-56"
          >
            {email && (
              <>
                <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                  {email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={openSettings}>
                <SettingsIcon />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => startTransition(signOut)}>
                <LogOutIcon />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
