"use client";

import { useActionState } from "react";
import {
  CheckEmail,
  FieldErrors,
  fieldErrors,
  FormAlert,
  SubmitButton,
} from "@/features/auth/components/form-parts";
import { signIn } from "@/features/auth/server/actions";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type SignInFormProps = {
  /** Same-origin path to return to after signing in. */
  next: string;
  onReset: () => void;
};

/** Sign in with a password, or have a sign-in link emailed. */
export function SignInForm({ next, onReset }: SignInFormProps) {
  const [state, formAction] = useActionState(signIn, null);
  if (state?.ok) return <CheckEmail email={state.email} onBack={onReset} />;

  const emailErrors = fieldErrors(state, "email");
  const passwordErrors = fieldErrors(state, "password");

  return (
    <form action={formAction}>
      <input type="hidden" name="next" value={next} />
      <FieldGroup>
        <FormAlert state={state} />
        <Field data-invalid={Boolean(emailErrors)}>
          <FieldLabel htmlFor="sign-in-email">Email</FieldLabel>
          <Input
            id="sign-in-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={state?.email}
            aria-invalid={Boolean(emailErrors)}
            aria-describedby="sign-in-email-error"
          />
          <FieldErrors id="sign-in-email-error" errors={emailErrors} />
        </Field>
        <Field data-invalid={Boolean(passwordErrors)}>
          <FieldLabel htmlFor="sign-in-password">Password</FieldLabel>
          <Input
            id="sign-in-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={Boolean(passwordErrors)}
            aria-describedby="sign-in-password-error"
          />
          <FieldErrors id="sign-in-password-error" errors={passwordErrors} />
        </Field>
        <SubmitButton intent="password">Sign in</SubmitButton>
        <FieldSeparator>or</FieldSeparator>
        <Field>
          {/* Skips the browser's check that the password is filled in. */}
          <SubmitButton intent="link" variant="outline" formNoValidate>
            Email me a sign-in link
          </SubmitButton>
          <FieldDescription className="text-center">
            No password needed: the link signs you in.
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  );
}
