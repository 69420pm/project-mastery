/**
 * The first messages the Today card's buttons send as the Student in a new
 * Chat. The new Chat page sends only these, so a link can't put other words
 * in the Student's mouth.
 */
export const TODAY_MESSAGES = {
  start: "Let's start.",
  review: "Let's review.",
  exam: "Exam problems please.",
} as const;

/** The first message of a Chat opened to go through a graded Mock exam. */
export const MOCK_REVIEW_MESSAGE = "Let's go through my mock exam.";

/** Whether `text` is one of the Today card's first messages. */
export function isTodayMessage(text: unknown): text is string {
  return Object.values(TODAY_MESSAGES).some((message) => message === text);
}
