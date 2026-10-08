import { z } from "zod";

/** The longest message a Student can send, in characters. */
export const MAX_MESSAGE_LENGTH = 10_000;

export const messageTooLongMessage = `Your message is too long. Keep it under ${MAX_MESSAGE_LENGTH.toLocaleString("en-US")} characters.`;

/**
 * Metadata the server attaches to AI messages (see `ChatMessageMetadata`).
 * Student messages have none.
 */
export const chatMessageMetadataSchema = z
  .object({
    modelId: z.string().optional(),
    stopped: z.boolean().optional(),
  })
  .optional();

/** A Student's message: text only. */
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
        MAX_MESSAGE_LENGTH,
      messageTooLongMessage,
    ),
});

/**
 * The body `useChat` posts to the Chat route: only the new message, as in the
 * AI SDK message persistence guide. `newChat` allows creating the Chat with
 * this id; without it the Chat must exist.
 */
export const chatRequestSchema = z.object({
  chatId: z.uuid(),
  newChat: z.boolean().optional(),
  /**
   * The key of the Student's model choice for this message, never a model
   * id. The server checks it against the offered choices. Without one, the
   * Chat's last choice is used.
   */
  modelChoice: z.string().max(100).optional(),
  message: studentMessageSchema,
});

/** The longest title a Student can give a Chat, in characters. */
export const MAX_TITLE_LENGTH = 100;

/** Renaming a Chat from its "…" menu. */
export const renameChatSchema = z.object({
  chatId: z.uuid(),
  title: z
    .string()
    .trim()
    .min(1, "Enter a title.")
    .max(
      MAX_TITLE_LENGTH,
      `Keep the title under ${MAX_TITLE_LENGTH} characters.`,
    ),
});

/** A Chat addressed by id. */
export const chatIdSchema = z.object({ chatId: z.uuid() });

/** Deleting a Chat from its "…" menu. */
export const deleteChatSchema = chatIdSchema.extend({
  /** The Student is on the Chat's page, so they land on a new Chat. */
  leave: z.boolean().optional(),
});

/** The model choice of a new Chat, as in the database's `chats` default. */
export const DEFAULT_MODEL_CHOICE = "balanced";

export type ChatRequest = z.infer<typeof chatRequestSchema>;
