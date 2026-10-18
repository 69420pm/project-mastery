"use client";

import { LayoutGridIcon } from "lucide-react";
import { SidebarLink } from "@/components/sidebar-link";
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar";
import { COURSE_LIST_PATH } from "@/features/courses/domain/course-paths";

/**
 * The sidebar's link to the Course list, on the Course list itself. The page
 * lists the Courses, so the sidebar does not repeat them.
 */
export function CourseListLink() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarLink href={COURSE_LIST_PATH}>
          <LayoutGridIcon />
          <span>Courses</span>
        </SidebarLink>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
