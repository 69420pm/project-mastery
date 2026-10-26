/** A Mock exam's page. */
export function mockExamPath(courseId: string, mockId: string): string {
  return `/courses/${courseId}/mock/${mockId}`;
}

/** A Mock exam's status as its page shows it. */
export type MockStatus =
  "assembling" | "ready" | "in_progress" | "submitted" | "failed";

/** How long a mock may assemble before it counts as failed. */
const ASSEMBLY_MS = 60 * 60 * 1000;

/** Why a mock that assembled too long failed, as the database says it. */
export const STALE_ASSEMBLY = "Assembling took longer than an hour.";

/**
 * A stored mock's status at `now`: one still assembling an hour after it
 * was queued counts as failed, as `queue_mock_exam` then marks it.
 */
export function mockStatus(
  row: { status: string; failure: string | null; created_at: string },
  now: Date,
): { status: MockStatus; failure: string | null } {
  if (
    row.status === "assembling" &&
    now.getTime() - Date.parse(row.created_at) > ASSEMBLY_MS
  ) {
    return { status: "failed", failure: STALE_ASSEMBLY };
  }
  return { status: row.status as MockStatus, failure: row.failure };
}
