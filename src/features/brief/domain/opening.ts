import { createHash } from "node:crypto";

/** The first message of every Brief: static, so opening a Brief costs no model call. */
export const OPENING_MESSAGE =
  "Let's get you set up for your exam. When is it? Tell me the date, and anything else you already know about it.";

/** A stable message id for `key`, so a static message is stored once. */
function staticMessageId(key: string): string {
  const hex = createHash("sha1").update(key).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/**
 * The opening message's id, derived from the Course's so that two tabs
 * opening the Brief at once store it once.
 */
export function openingMessageId(courseId: string): string {
  return staticMessageId(`brief:${courseId}`);
}

/**
 * The id of the static message that asks whether `materialIds` are old
 * exams, so the same question is stored once.
 */
export function oldExamsMessageId(materialIds: string[]): string {
  return staticMessageId(`old-exams:${materialIds.toSorted().join(",")}`);
}
