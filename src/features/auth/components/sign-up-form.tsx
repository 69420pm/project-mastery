"use client";

import { useActionState } from "react";
import {
  CheckEmail,
  FieldErrors,
  fieldErrors,
  FormAlert,
  SubmitButton,
} from "@/features/auth/components/form-parts";
import { signUp } from "@/features/auth/server/actions";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type SignUpFormProps = {
  /** Same-origin path to return to after confirming the email. */
  next: string;
  onReset: () => void;
};

/** Create an account with email and password, confirmed by email. */
export function SignUpForm({ next, onReset }: SignUpFormProps) {
  const [state, formAction] = useActionState(signUp, null);
  if (state?.ok) return <CheckEmail email={state.email} onBack={onReset} />;

  const emailErrors = fieldErrors(state, "email");
  const passwordErrors = fieldErrors(state, "password");

  return (
    <form action={formAction}>
      <input type="hidden" name="next" value={next} />
      <FieldGroup>
        <FormAlert state={state} />
        <Field data-invalid={Boolean(emailErrors)}>
          <FieldLabel htmlFor="sign-up-email">Email</FieldLabel>
          <Input
            id="sign-up-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={state?.email}
            aria-invalid={Boolean(emailErrors)}
            aria-describedby="sign-up-email-error"
          />
          <FieldErrors id="sign-up-email-error" errors={emailErrors} />
        </Field>
        <Field data-invalid={Boolean(passwordErrors)}>
          <FieldLabel htmlFor="sign-up-password">Password</FieldLabel>
          <Input
            id="sign-up-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            required
            aria-invalid={Boolean(passwordErrors)}
            aria-describedby="sign-up-password-hint sign-up-password-error"
          />
          <FieldDescription id="sign-up-password-hint">
            At least 8 characters.
          </FieldDescription>
          <FieldErrors id="sign-up-password-error" errors={passwordErrors} />
        </Field>
        <SubmitButton>Create account</SubmitButton>
      </FieldGroup>
    </form>
  );
}
