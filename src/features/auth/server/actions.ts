"use server";

import type { AuthError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { LoginMessageCode } from "@/features/auth/domain/login-messages";
import {
  magicLinkSchema,
  signInSchema,
  signUpSchema,
} from "@/features/auth/schemas";
import { CONFIRM_PATH, safeRedirectPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

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
  return { origin, next, fields: Object.fromEntries(formData) };
}

function redirectToLogin(params: {
  error?: LoginMessageCode;
  message?: LoginMessageCode;
  next?: string;
}): never {
  const search = new URLSearchParams();
  if (params.error) search.set("error", params.error);
  if (params.message) search.set("message", params.message);
  if (params.next && params.next !== "/") search.set("next", params.next);
  redirect(`/login?${search}`);
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

export async function signInWithPassword(formData: FormData) {
  const { next, fields } = await readForm(formData);
  const input = signInSchema.safeParse(fields);
  if (!input.success) redirectToLogin({ error: "invalid-input", next });

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(input.data);
  if (error) redirectToLogin({ error: toMessageCode(error), next });

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signUp(formData: FormData) {
  const { origin, next, fields } = await readForm(formData);
  const input = signUpSchema.safeParse(fields);
  if (!input.success) redirectToLogin({ error: "invalid-input", next });

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    ...input.data,
    options: { emailRedirectTo: confirmUrl(origin, next) },
  });
  if (error) redirectToLogin({ error: toMessageCode(error), next });

  // With email confirmation on, Supabase answers the same way whether or not
  // the address already has an account, so this reveals nothing.
  redirectToLogin({ message: "check-email" });
}

export async function signInWithMagicLink(formData: FormData) {
  const { origin, next, fields } = await readForm(formData);
  const input = magicLinkSchema.safeParse(fields);
  if (!input.success) redirectToLogin({ error: "invalid-input", next });

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: input.data.email,
    options: { emailRedirectTo: confirmUrl(origin, next) },
  });
  if (error) redirectToLogin({ error: toMessageCode(error), next });

  redirectToLogin({ message: "check-email" });
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirectToLogin({ message: "signed-out" });
}
