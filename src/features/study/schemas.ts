import { z } from "zod";

/** The most characters a Course's Memory holds. */
export const MAX_MEMORY_LENGTH = 4000;

/** The input of End session's Server Action, and of the close card's read. */
export const endSessionSchema = z.object({ chatId: z.uuid() });

/** The most characters of the note on a session's rating. */
export const MAX_RATING_NOTE_LENGTH = 300;

/** The input of the close card's rating Server Action. */
export const rateSessionSchema = z.object({
  chatId: z.uuid(),
  rating: z.int().min(1).max(5),
  note: z
    .string()
    .trim()
    .max(
      MAX_RATING_NOTE_LENGTH,
      `A note holds at most ${MAX_RATING_NOTE_LENGTH} characters.`,
    )
    .optional(),
});

/** The input of the Topic map's read: a Topic of the Course. */
export const topicMapSchema = z.object({
  courseId: z.uuid(),
  topicId: z.uuid(),
});

/** Why a message to an ended Study session is refused. */
export const sessionEndedMessage =
  "This study session has ended, so it takes no more messages. Start a new session to keep studying.";

/** The most characters of a reason for skipping a Topic. */
export const MAX_SKIP_REASON_LENGTH = 200;

/**
 * The input of the Topic page's pin and skip Server Action: the choice to
 * make, or null to clear it. Only a skip takes a reason.
 */
export const setTopicChoiceSchema = z.object({
  courseId: z.uuid(),
  topicId: z.uuid(),
  choice: z.enum(["pinned", "skipped"]).nullable(),
  reason: z.string().trim().max(MAX_SKIP_REASON_LENGTH).optional(),
});

/** The input of the Memory card's Server Action. */
export const saveMemorySchema = z.object({
  courseId: z.uuid(),
  text: z
    .string()
    .max(
      MAX_MEMORY_LENGTH,
      `Memory holds at most ${MAX_MEMORY_LENGTH} characters.`,
    ),
});
