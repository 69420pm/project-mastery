"use client";

import { type MouseEvent, useState, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
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
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete(event: MouseEvent) {
    // Stay open until the Course is gone, or to show why it is not.
    event.preventDefault();
    startTransition(async () => {
      const result = await deleteCourse({ courseId: course.id });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onOpenChange(false);
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setError(null);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete course?</AlertDialogTitle>
          <AlertDialogDescription>{deletedWith(course)}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isPending}
            onClick={handleDelete}
          >
            {isPending && <Spinner data-icon="inline-start" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
