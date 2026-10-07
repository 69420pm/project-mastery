import type { ActionResult } from "@/lib/validation/action";

/**
 * What the auth forms show after a submission. `ok: true` means an email with
 * a link was sent; a successful password sign-in redirects instead. `email`
 * refills the field, since React resets the form after the action.
 */
export type AuthFormState = ActionResult & { email: string };
