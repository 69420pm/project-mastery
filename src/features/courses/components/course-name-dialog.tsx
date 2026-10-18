"use client";

import { NameDialog } from "@/components/name-dialog";
import { MAX_COURSE_NAME_LENGTH } from "@/features/courses/schemas";
import type { ActionResult } from "@/lib/validation/action";

type CourseNameDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  initialName?: string;
  /** The longest name allowed. Defaults to a Course name's limit. */
  maxLength?: number;
  placeholder?: string;
  /** Saves the name. A failure shows its message under the field. */
  onSave: (name: string) => Promise<ActionResult<unknown>>;
};

/**
 * Asks for a name, to create or rename a Course or rename a Material. It
 * closes once the name is saved, and the refreshed page shows it.
 */
export function CourseNameDialog({
  initialName,
  maxLength = MAX_COURSE_NAME_LENGTH,
  placeholder = "Linear Algebra",
  ...props
}: CourseNameDialogProps) {
  return (
    <NameDialog
      {...props}
      initialValue={initialName}
      maxLength={maxLength}
      placeholder={placeholder}
    />
  );
}
