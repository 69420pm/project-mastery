"use client";

import { WaypointsIcon } from "lucide-react";
import { SidebarLink } from "@/components/sidebar-link";
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar";
import { knowledgeMapPath } from "@/features/knowledge-map/domain/map-paths";

/** The sidebar's link to the Course's Knowledge map page. */
export function KnowledgeMapLink({ courseId }: { courseId: string }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarLink href={knowledgeMapPath(courseId)}>
          <WaypointsIcon />
          <span>Knowledge map</span>
        </SidebarLink>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
