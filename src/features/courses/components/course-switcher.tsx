"use client";

import { BookOpenIcon, ChevronsUpDownIcon, LayoutGridIcon } from "lucide-react";
import Link from "next/link";
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
import {
  COURSE_LIST_PATH,
  coursePath,
} from "@/features/courses/domain/course-paths";
import type { CourseListItem } from "@/features/courses/types";

type CourseSwitcherProps = {
  /** The open Course. */
  course: CourseListItem;
  /** All the Student's Courses, most recently used first. */
  courses: CourseListItem[];
};

/**
 * The sidebar's Course switcher inside a Course: shows the open Course and
 * offers the Student's other Courses and the Course list.
 */
export function CourseSwitcher({ course, courses }: CourseSwitcherProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const others = courses.filter(({ id }) => id !== course.id);
  const closeSlideOver = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              <BookOpenIcon />
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate font-medium">{course.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  Switch course
                </span>
              </span>
              <ChevronsUpDownIcon className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side={isMobile ? "bottom" : "right"}
            className="min-w-56"
          >
            {others.length > 0 && (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Other courses</DropdownMenuLabel>
                  {others.map((other) => (
                    <DropdownMenuItem key={other.id} asChild>
                      <Link
                        href={coursePath(other.id)}
                        onClick={closeSlideOver}
                      >
                        <BookOpenIcon />
                        <span className="truncate">{other.name}</span>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem asChild>
              <Link href={COURSE_LIST_PATH} onClick={closeSlideOver}>
                <LayoutGridIcon />
                All courses
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
