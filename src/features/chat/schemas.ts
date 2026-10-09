import { z } from "zod";
import { materialReferenceSchema } from "@/features/courses";

/** The longest message a Student can send, in characters. */
export const MAX_MESSAGE_LENGTH = 10_000;

export const messageTooLongMessage = `Your message is too long. Keep it under ${MAX_MESSAGE_LENGTH.toLocaleString("en-US")} characters.`;

/** What a Student sees for a Chat that is missing or not theirs. */
export const chatNotFoundMessage = "This chat does not exist.";

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

/** The most Materials a Student can attach to one message. */
export const MAX_ATTACHED_MATERIALS = 5;

export const tooManyMaterialsMessage = `Attach up to ${MAX_ATTACHED_MATERIALS} materials to a message.`;

/** The data part that attaches a Material to a Student's message. */
export const materialPartSchema = z.object({
  type: z.literal("data-material"),
  data: materialReferenceSchema,
});

const textPartSchema = z.object({ type: z.literal("text"), text: z.string() });

/** A Student's message: text, attached Materials, or both. */
const studentMessageSchema = z.object({
  id: z.uuid(),
  role: z.literal("user"),
  parts: z
    .array(z.discriminatedUnion("type", [textPartSchema, materialPartSchema]))
    .min(1)
    .refine(
      (parts) =>
        parts.some(
          (part) => part.type === "data-material" || part.text.trim() !== "",
        ),
      "Your message is empty.",
    )
    .refine(
      (parts) =>
        parts.reduce(
          (length, part) =>
            length + (part.type === "text" ? part.text.length : 0),
          0,
        ) <= MAX_MESSAGE_LENGTH,
      messageTooLongMessage,
    )
    .refine(
      (parts) =>
        parts.filter((part) => part.type === "data-material").length <=
        MAX_ATTACHED_MATERIALS,
      tooManyMaterialsMessage,
    ),
});

/**
 * The body `useChat` posts to the Chat route: only the new message, as in the
 * AI SDK message persistence guide. `courseId` allows creating the Chat with
 * this id in that Course; without it the Chat must exist.
 */
export const chatRequestSchema = z.object({
  chatId: z.uuid(),
  courseId: z.uuid().optional(),
  /**
   * The key of the Student's model choice for this message, never a model
   * id. The server checks it against the offered choices. Without one, the
   * Chat's last choice is used.
   */
  modelChoice: z.string().max(100).optional(),
  message: studentMessageSchema,
});

/** The longest title a Student can give a Chat, in characters. */
export const MAX_TYPED_TITLE_LENGTH = 100;

/** Renaming a Chat from its "…" menu. */
export const renameChatSchema = z.object({
  chatId: z.uuid(),
  title: z
    .string()
    .trim()
    .min(1, "Enter a title.")
    .max(
      MAX_TYPED_TITLE_LENGTH,
      `Keep the title under ${MAX_TYPED_TITLE_LENGTH} characters.`,
    ),
});

/** A Chat addressed by id. */
export const chatIdSchema = z.object({ chatId: z.uuid() });

/** Deleting a Chat from its "…" menu. */
export const deleteChatSchema = chatIdSchema.extend({
  /** The Student is on the Chat's page, so they land on a new Chat. */
  leave: z.boolean().optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
