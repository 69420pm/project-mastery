/** How long a session may sit without a message before it counts as ended. */
const IDLE_MS = 2 * 60 * 60 * 1000;

/**
 * When a session ended, as an ISO timestamp, or null while it runs: its
 * `ended_at`, or else its Chat's newest message once that is more than 2
 * hours before `now`.
 */
export function sessionEnd(
  session: { endedAt: string | null; newestMessageAt: string | null },
  now: Date,
): string | null {
  if (session.endedAt !== null) return session.endedAt;
  const newest = session.newestMessageAt;
  if (newest !== null && now.getTime() - Date.parse(newest) > IDLE_MS) {
    return newest;
  }
  return null;
}
