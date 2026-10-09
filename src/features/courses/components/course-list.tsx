"use client";

import {
  BookOpenIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CourseNameDialog } from "@/features/courses/components/course-name-dialog";
import { DeleteCourseDialog } from "@/features/courses/components/delete-course-dialog";
import { createCourse, renameCourse } from "@/features/courses/server/actions";
import { coursePath } from "@/features/courses/domain/course-paths";
import type { CourseWithCounts } from "@/features/courses/types";

/**
 * The Student's Courses, most recently updated first, with creating,
 * renaming and deleting them. Without Courses it invites the Student to
 * create their first one.
 */
export function CourseList({ courses }: { courses: CourseWithCounts[] }) {
  const [creating, setCreating] = useState(false);

  const newCourseButton = (
    <Button onClick={() => setCreating(true)}>
      <PlusIcon data-icon="inline-start" />
      New course
    </Button>
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-4 pb-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Courses</h1>
        {courses.length > 0 && newCourseButton}
      </div>

      {courses.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
          <BookOpenIcon className="size-8 text-muted-foreground" />
          <h2 className="text-lg font-medium">Create your first course</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            A course keeps everything for one exam together. Name it after the
            lecture you are preparing for.
          </p>
          {newCourseButton}
        </div>
      ) : (
        <ul
          aria-label="Courses"
          className="flex flex-col divide-y rounded-xl border"
        >
          {courses.map((course) => (
            <CourseListEntry key={course.id} course={course} />
          ))}
        </ul>
      )}

      <CourseNameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New course"
        submitLabel="Create"
        onSave={(name) => createCourse({ name })}
      />
    </div>
  );
}

/**
 * One Course in the list, opening a new Chat in it, with its "…" menu to
 * rename or delete it.
 */
function CourseListEntry({ course }: { course: CourseWithCounts }) {
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);

  return (
    <li className="flex items-center gap-2 py-2 pr-2 pl-4">
      <Link
        href={coursePath(course.id)}
        className="min-w-0 flex-1 truncate rounded-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {course.name}
      </Link>
      {/* Not modal, so focus moves cleanly into a dialog opened from it. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Course actions">
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => setDialog("rename")}>
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDialog("delete")}
            >
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <CourseNameDialog
        open={dialog === "rename"}
        onOpenChange={(open) => setDialog(open ? "rename" : null)}
        title="Rename course"
        submitLabel="Save"
        initialName={course.name}
        onSave={(name) => renameCourse({ courseId: course.id, name })}
      />
      <DeleteCourseDialog
        course={course}
        open={dialog === "delete"}
        onOpenChange={(open) => setDialog(open ? "delete" : null)}
      />
    </li>
  );
}
