import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { confirmRedirectPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

const emailOtpTypeSchema = z.enum([
  "email",
  "signup",
  "magiclink",
  "invite",
  "recovery",
  "email_change",
]) satisfies z.ZodType<EmailOtpType>;

/**
 * Target of the links in auth emails. Signs the user in, then redirects to
 * the `next` path. Handles both link styles:
 * - `token_hash` + `type` from the project's email templates (works in any
 *   browser),
 * - `code` from Supabase's default PKCE flow (works only in the browser that
 *   requested the email).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = confirmRedirectPath(searchParams.get("next"), origin);
  const tokenHash = searchParams.get("token_hash");
  const type = emailOtpTypeSchema.safeParse(searchParams.get("type"));
  const code = searchParams.get("code");

  const supabase = await createClient();

  if (tokenHash && type.success) {
    const { error } = await supabase.auth.verifyOtp({
      type: type.data,
      token_hash: tokenHash,
    });
    if (!error) redirect(next);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) redirect(next);
  }

  redirect("/auth/error");
}
