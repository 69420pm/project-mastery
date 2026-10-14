import { z } from "zod";

/** The longest message a Student can send in a Brief, in characters. */
export const MAX_BRIEF_MESSAGE_LENGTH = 10_000;

export const briefMessageTooLongMessage = `Your message is too long. Keep it under ${MAX_BRIEF_MESSAGE_LENGTH.toLocaleString("en-US")} characters.`;

export const briefNotFoundMessage = "This Brief does not exist.";

/** Metadata the server attaches to AI messages (see `BriefMessageMetadata`). */
export const briefMessageMetadataSchema = z
  .object({ modelId: z.string().optional() })
  .optional();

/** A Student's message: text only, no attachments. */
const studentMessageSchema = z.object({
  id: z.uuid(),
  role: z.literal("user"),
  parts: z
    .array(z.object({ type: z.literal("text"), text: z.string() }))
    .min(1)
    .refine(
      (parts) => parts.some((part) => part.text.trim() !== ""),
      "Your message is empty.",
    )
    .refine(
      (parts) =>
        parts.reduce((length, part) => length + part.text.length, 0) <=
        MAX_BRIEF_MESSAGE_LENGTH,
      briefMessageTooLongMessage,
    ),
});

/** The body `useChat` posts to the Brief route: only the new message. */
export const briefRequestSchema = z.object({
  courseId: z.uuid(),
  message: studentMessageSchema,
});
