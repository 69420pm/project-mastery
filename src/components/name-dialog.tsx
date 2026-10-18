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
import type { ActionResult } from "@/lib/validation/action";

type NameDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The field's label. Defaults to "Name". */
  label?: string;
  submitLabel: string;
  initialValue?: string;
  maxLength: number;
  placeholder?: string;
  /**
   * Saves the value. A failure shows its field error, or else its message,
   * under the field.
   */
  onSave: (value: string) => Promise<ActionResult<unknown>>;
};

/** Asks for one short text, such as a name, and closes once it is saved. */
export function NameDialog({ open, onOpenChange, ...form }: NameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        {/* Mounted per opening, so it starts from the initial value. */}
        <NameForm {...form} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NameForm({
  title,
  label = "Name",
  submitLabel,
  initialValue = "",
  maxLength,
  placeholder,
  onSave,
  onDone,
}: Omit<NameDialogProps, "open" | "onOpenChange"> & { onDone: () => void }) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await onSave(value);
      if (!result.ok) {
        // The form has one field, so any field error is about it.
        const fieldError = Object.values(result.fieldErrors ?? {})[0]?.[0];
        setError(fieldError ?? result.message);
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
          <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
          <Input
            id={inputId}
            value={value}
            maxLength={maxLength}
            placeholder={placeholder}
            aria-invalid={error !== null}
            onChange={(event) => {
              setValue(event.target.value);
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
