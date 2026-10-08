/** The cookie in which the Sidebar (`ui/sidebar`) stores whether it is open. */
export const SIDEBAR_COOKIE_NAME = "sidebar_state";

/**
 * Whether the Sidebar was left open, from the request's cookies, so the
 * server renders it that way. It is open until the Student closes it.
 */
export function isSidebarOpen(cookies: {
  get(name: string): { value: string } | undefined;
}): boolean {
  return cookies.get(SIDEBAR_COOKIE_NAME)?.value !== "false";
}
