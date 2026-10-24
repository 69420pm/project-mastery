import { z } from "zod";

/** The most characters a Course's Memory holds. */
export const MAX_MEMORY_LENGTH = 4000;

/** The input of End session's Server Action. */
export const endSessionSchema = z.object({ chatId: z.uuid() });

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
