import { createHash } from "node:crypto";

/** The first message of every Brief: static, so opening a Brief costs no model call. */
export const OPENING_MESSAGE =
  "Let's get you set up for your exam. When is it? Tell me the date, and anything else you already know about it.";

/** The `model_id` stored with the opening message, which no model wrote. */
export const OPENING_MODEL_ID = "static";

/**
 * The opening message's id, derived from the Course's so that two tabs
 * opening the Brief at once store it once.
 */
export function openingMessageId(courseId: string): string {
  const hex = createHash("sha1").update(`brief:${courseId}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}
