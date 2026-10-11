/**
 * The reasons a Student sees for a failed parse, next to "Failed" on the
 * Materials page. Short and plain: what went wrong, not how.
 */

/** The Student's Daily limit, or the provider's daily quota, is used up. */
export const dailyLimitReason = "Daily limit reached";

/** The file could not be downloaded or opened as a PDF. */
export const fileUnreadableReason = "The file could not be opened";

/** The page call for a page failed for good. */
export function pageUnreadableReason(pageNumber: number): string {
  return `The AI could not read page ${pageNumber}`;
}

/** Any other step failed for good. */
export const parseFailedReason =
  "The material could not be parsed. Please try again.";
