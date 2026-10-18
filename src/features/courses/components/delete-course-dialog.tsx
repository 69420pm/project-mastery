"use client";

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { deleteCourse } from "@/features/courses/server/actions";
import type { CourseWithCounts } from "@/features/courses/types";

type DeleteCourseDialogProps = {
  course: CourseWithCounts;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** What the confirmation says goes with the Course. */
function deletedWith({
  name,
  chatCount,
  materialCount,
}: CourseWithCounts): string {
  const contents = [
    counted(chatCount, "chat", "chats"),
    counted(materialCount, "material", "materials"),
  ].filter(Boolean);
  const along = contents.length > 0 ? ` and its ${contents.join(" and ")}` : "";
  return `“${name}”${along} will be deleted for good. This cannot be undone.`;
}

function counted(count: number, one: string, many: string): string {
  if (count === 0) return "";
  return `${count} ${count === 1 ? one : many}`;
}

/** Asks before deleting a Course for good, with its Chats and Materials. */
export function DeleteCourseDialog({
  course,
  open,
  onOpenChange,
}: DeleteCourseDialogProps) {
  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete course?"
      description={deletedWith(course)}
      onConfirm={() => deleteCourse({ courseId: course.id })}
    />
  );
}
