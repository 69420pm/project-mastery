import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type AuthUser = {
  id: string;
  email: string | undefined;
};

/**
 * Returns the signed-in user, or `null`. Verifies the session JWT with
 * `getClaims()` instead of trusting the cookie (never use `getSession()` for
 * this on the server). Cached per request, so layouts and pages can both call
 * it.
 */
export const getUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;

  return { id: data.claims.sub, email: data.claims.email };
});

/**
 * Returns the signed-in user or redirects to `/login`. Call it at the top of
 * every protected page, Server Action and Route Handler; the proxy does not
 * protect routes. `next` is where to return after signing in.
 */
export async function requireUser(next?: string): Promise<AuthUser> {
  const user = await getUser();
  if (!user) {
    redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  }
  return user;
}
