"use client";

import { BookOpenIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RowActionsMenu } from "@/components/row-actions-menu";
import { Button } from "@/components/ui/button";
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
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6">
      <PageHeader
        title="Courses"
        description="Each course keeps the materials and chats for one exam."
        actions={courses.length > 0 && newCourseButton}
      />

      {courses.length === 0 ? (
        <EmptyState
          icon={<BookOpenIcon />}
          title="Create your first course"
          description="A course keeps everything for one exam together. Name it after the lecture you are preparing for."
          action={newCourseButton}
        />
      ) : (
        <ul
          aria-label="Courses"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
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

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * One Course in the list, a card that opens a new Chat in it, with its "…"
 * menu to rename or delete it.
 */
function CourseListEntry({ course }: { course: CourseWithCounts }) {
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);

  return (
    <li className="group relative flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-muted/50">
      <div
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground"
      >
        <BookOpenIcon className="size-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* The link covers the card; the menu sits above it. */}
        <Link
          href={coursePath(course.id)}
          className="truncate font-medium outline-none after:absolute after:inset-0 after:rounded-xl"
        >
          {course.name}
        </Link>
        <p className="text-sm text-muted-foreground">
          {plural(course.materialCount, "material")} ·{" "}
          {plural(course.chatCount, "chat")}
        </p>
      </div>
      <div className="relative -my-1 -mr-2">
        <RowActionsMenu
          label="Course actions"
          onRename={() => setDialog("rename")}
          onDelete={() => setDialog("delete")}
        />
      </div>
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
