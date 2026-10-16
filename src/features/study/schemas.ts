import { z } from "zod";

/** The most characters a Course's Memory holds. */
export const MAX_MEMORY_LENGTH = 4000;

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
