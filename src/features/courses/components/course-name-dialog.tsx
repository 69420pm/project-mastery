"use client";

import { type FormEvent, useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
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
  open,
  onOpenChange,
  ...form
}: CourseNameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        {/* Mounted per opening, so it starts from the initial name. */}
        <CourseNameForm {...form} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CourseNameForm({
  title,
  submitLabel,
  initialName = "",
  maxLength = MAX_COURSE_NAME_LENGTH,
  placeholder = "Linear Algebra",
  onSave,
  onDone,
}: Omit<CourseNameDialogProps, "open" | "onOpenChange"> & {
  onDone: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await onSave(name);
      if (!result.ok) {
        setError(result.fieldErrors?.name?.[0] ?? result.message);
        return;
      }
      onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={error !== null || undefined}>
          <FieldLabel htmlFor={inputId}>Name</FieldLabel>
          <Input
            id={inputId}
            value={name}
            maxLength={maxLength}
            placeholder={placeholder}
            aria-invalid={error !== null}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
          {error && <FieldError>{error}</FieldError>}
        </Field>
      </FieldGroup>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={isPending}>
          {isPending && <Spinner data-icon="inline-start" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
