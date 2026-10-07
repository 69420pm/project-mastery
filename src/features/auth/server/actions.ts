"use server";

import type { AuthError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  loginMessages,
  type LoginMessageCode,
} from "@/features/auth/domain/login-messages";
import {
  magicLinkSchema,
  signInSchema,
  signUpSchema,
} from "@/features/auth/schemas";
import type { AuthFormState } from "@/features/auth/types";
import { CONFIRM_PATH, safeRedirectPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";
import { parseActionInput } from "@/lib/validation/action";

/** The site's origin, for links in auth emails. */
async function getOrigin() {
  const headerList = await headers();
  const origin = headerList.get("origin");
  if (origin) return origin;
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const protocol = headerList.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

/**
 * Where the link in an auth email leads: /auth/confirm signs the user in, then
 * redirects to `next`.
 */
function confirmUrl(origin: string, next: string) {
  const url = new URL(CONFIRM_PATH, origin);
  url.searchParams.set("next", next);
  return url.toString();
}

/** Reads the form fields every auth form shares. */
async function readForm(formData: FormData) {
  const origin = await getOrigin();
  const nextField = formData.get("next");
  const next = safeRedirectPath(
    typeof nextField === "string" ? nextField : null,
    origin,
  );
  const emailField = formData.get("email");
  const email = typeof emailField === "string" ? emailField : "";
  return { origin, next, email };
}

function toMessageCode(error: AuthError): LoginMessageCode {
  switch (error.code) {
    case "invalid_credentials":
      return "invalid-credentials";
    case "email_not_confirmed":
      return "email-not-confirmed";
    case "weak_password":
      return "weak-password";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "rate-limited";
    default:
      return "unexpected";
  }
}

function authFailure(error: AuthError, email: string): AuthFormState {
  return { ok: false, message: loginMessages[toMessageCode(error)], email };
}

/**
 * The sign-in form. Its submit buttons set `intent`: `password` signs in and
 * redirects to `next`, `link` emails a sign-in link.
 */
export async function signIn(
  _prev: AuthFormState | null,
  formData: FormData,
): Promise<AuthFormState> {
  const { origin, next, email } = await readForm(formData);
  const supabase = await createClient();

  if (formData.get("intent") === "link") {
    const input = parseActionInput(magicLinkSchema, formData);
    if (!input.ok) return { ...input, email };

    const { error } = await supabase.auth.signInWithOtp({
      email: input.data.email,
      options: { emailRedirectTo: confirmUrl(origin, next) },
    });
    if (error) return authFailure(error, email);
    return { ok: true, data: undefined, email: input.data.email };
  }

  const input = parseActionInput(signInSchema, formData);
  if (!input.ok) return { ...input, email };

  const { error } = await supabase.auth.signInWithPassword(input.data);
  if (error) return authFailure(error, email);

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signUp(
  _prev: AuthFormState | null,
  formData: FormData,
): Promise<AuthFormState> {
  const { origin, next, email } = await readForm(formData);
  const input = parseActionInput(signUpSchema, formData);
  if (!input.ok) return { ...input, email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    ...input.data,
    options: { emailRedirectTo: confirmUrl(origin, next) },
  });
  if (error) return authFailure(error, email);

  // With email confirmation on, Supabase answers the same way whether or not
  // the address already has an account, so this reveals nothing.
  return { ok: true, data: undefined, email: input.data.email };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect("/login?message=signed-out");
}
