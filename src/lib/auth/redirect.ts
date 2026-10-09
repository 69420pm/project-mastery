/** The route that email links lead to. */
export const CONFIRM_PATH = "/auth/confirm";

/** Where signing in leads when there is no `next` path to return to. */
export const SIGNED_IN_PATH = "/courses";

/**
 * Turns an untrusted redirect target (a `next` query parameter or form field)
 * into a same-origin path. Anything that would leave the site, such as
 * `//evil.example` or `https://evil.example`, falls back to `fallback`.
 */
export function safeRedirectPath(
  target: string | null | undefined,
  origin: string,
  fallback = SIGNED_IN_PATH,
): string {
  if (!target) return fallback;
  try {
    const url = new URL(target, origin);
    if (url.origin !== new URL(origin).origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/**
 * Resolves the `next` parameter of an email link to /auth/confirm.
 *
 * The Server Actions send `emailRedirectTo` as `/auth/confirm?next=<path>`,
 * which works with Supabase's default email templates (PKCE code). The
 * project's templates instead pass that whole URL as `next` together with a
 * token hash, so a `next` that points back at /auth/confirm is unwrapped to
 * its own `next`.
 */
export function confirmRedirectPath(
  target: string | null | undefined,
  origin: string,
): string {
  const path = safeRedirectPath(target, origin);
  const url = new URL(path, origin);
  if (url.pathname !== CONFIRM_PATH) return path;
  return safeRedirectPath(url.searchParams.get("next"), origin);
}
