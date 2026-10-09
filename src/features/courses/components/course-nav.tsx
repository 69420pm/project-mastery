"use client";

import { BookOpenIcon } from "lucide-react";
import { SidebarLink } from "@/components/sidebar-link";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { coursePath } from "@/features/courses/domain/course-paths";
import type { CourseListItem } from "@/features/courses/types";

/**
 * The Student's Courses in the sidebar of the Course list, most recently used
 * first. Each opens a new Chat in the Course.
 */
export function CourseNav({ courses }: { courses: CourseListItem[] }) {
  return (
    <SidebarGroup role="navigation" aria-label="Courses">
      <SidebarGroupLabel>Courses</SidebarGroupLabel>
      <SidebarGroupContent>
        {courses.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">No courses yet.</p>
        ) : (
          <SidebarMenu>
            {courses.map((course) => (
              <SidebarMenuItem key={course.id}>
                <SidebarLink href={coursePath(course.id)}>
                  <BookOpenIcon />
                  <span>{course.name}</span>
                </SidebarLink>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
