"use client";

import { CircleAlertIcon, MailCheckIcon } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import type { AuthFormState } from "@/features/auth/types";

/** The validation errors for one field of a failed submission. */
export function fieldErrors(state: AuthFormState | null, field: string) {
  if (!state || state.ok) return undefined;
  return state.fieldErrors?.[field];
}

/** Renders field errors with an id the input points to via `aria-describedby`. */
export function FieldErrors({
  id,
  errors,
}: {
  id: string;
  errors: string[] | undefined;
}) {
  return (
    <FieldError id={id} errors={errors?.map((message) => ({ message }))} />
  );
}

/**
 * A form error that belongs to no single field, such as wrong credentials.
 * Field errors render next to their inputs instead.
 */
export function FormAlert({ state }: { state: AuthFormState | null }) {
  if (!state || state.ok || state.fieldErrors) return null;
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  );
}

type SubmitButtonProps = React.ComponentProps<typeof Button> & {
  /** Sent as the `intent` field; the spinner shows on the button that was clicked. */
  intent?: string;
};

/** A submit button that is disabled while its form submits. */
export function SubmitButton({
  intent,
  children,
  ...props
}: SubmitButtonProps) {
  const { pending, data } = useFormStatus();
  const submitting = pending && (!intent || data?.get("intent") === intent);
  return (
    <Button
      type="submit"
      name={intent ? "intent" : undefined}
      value={intent}
      disabled={pending}
      {...props}
    >
      {submitting && <Spinner aria-hidden />}
      {children}
    </Button>
  );
}

/** Shown in place of a form once an email with a link is on its way. */
export function CheckEmail({
  email,
  onBack,
}: {
  email: string;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-4" role="status">
      <Alert>
        <MailCheckIcon />
        <AlertTitle>Check your inbox</AlertTitle>
        <AlertDescription>
          We sent a link to <span className="font-medium">{email}</span>. Open
          it on any device to continue.
        </AlertDescription>
      </Alert>
      <Button variant="ghost" onClick={onBack}>
        Use a different email
      </Button>
    </div>
  );
}
