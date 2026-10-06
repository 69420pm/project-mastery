/**
 * Messages the login page shows for `?error=` and `?message=` codes. Server
 * Actions redirect with a code instead of free text, so a crafted link cannot
 * put arbitrary text on the page.
 */
export const loginMessages = {
  "check-email": "Check your email for a link to continue.",
  "signed-out": "You are signed out.",
  "invalid-input": "Enter a valid email address and password.",
  "invalid-credentials": "Email or password is incorrect.",
  "email-not-confirmed":
    "Confirm your email address first. The link is in your inbox.",
  "weak-password": "Choose a password with at least 8 characters.",
  "rate-limited": "Too many attempts. Wait a moment and try again.",
  unexpected: "Something went wrong. Please try again.",
} as const;

export type LoginMessageCode = keyof typeof loginMessages;

/** Looks up the message for a code from the URL; unknown codes give `null`. */
export function getLoginMessage(code: string | string[] | undefined) {
  if (typeof code !== "string" || !Object.hasOwn(loginMessages, code)) {
    return null;
  }
  return loginMessages[code as LoginMessageCode];
}
