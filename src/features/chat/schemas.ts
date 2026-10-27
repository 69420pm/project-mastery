import { z } from "zod";
import { materialReferenceSchema } from "@/features/courses";
import type { TutorContext } from "@/features/study";

/** The longest message a Student can send, in characters. */
export const MAX_MESSAGE_LENGTH = 10_000;

export const messageTooLongMessage = `Your message is too long. Keep it under ${MAX_MESSAGE_LENGTH.toLocaleString("en-US")} characters.`;

/** What a Student sees for a Chat that is missing or not theirs. */
export const chatNotFoundMessage = "This chat does not exist.";

/**
 * A message's metadata (see `ChatMessageMetadata`): the question a Student's
 * answer is for, and what the server attaches to AI messages.
 */
export const chatMessageMetadataSchema = z
  .object({
    questionId: z.string().optional(),
    confidence: z.number().int().min(1).max(4).optional(),
    readingSectionId: z.string().optional(),
    modelId: z.string().optional(),
    stopped: z.boolean().optional(),
    // Built by the server and only displayed, so only its shape is checked.
    tutorContext: z
      .custom<TutorContext>(
        (value) =>
          typeof value === "object" && value !== null && !Array.isArray(value),
      )
      .optional(),
    usage: z
      .object({
        inputTokens: z.number(),
        cachedInputTokens: z.number(),
        outputTokens: z.number(),
        costUsd: z.number(),
        estimated: z.boolean(),
      })
      .optional(),
  })
  .optional();

/** The most Materials a Student can attach to one message. */
export const MAX_ATTACHED_MATERIALS = 5;

export const tooManyMaterialsMessage = `Attach up to ${MAX_ATTACHED_MATERIALS} materials to a message.`;

/** The data part that attaches a Material to a Student's message. */
const materialPartSchema = z.object({
  type: z.literal("data-material"),
  data: materialReferenceSchema,
});

const textPartSchema = z.object({ type: z.literal("text"), text: z.string() });

/**
 * A Student's message: text, attached Materials, or both. Sent from a
 * question card, it names the question it answers; sent with Done from a
 * reading card, the Reading section read, whose id is only checked for its
 * format.
 */
const studentMessageSchema = z.object({
  id: z.uuid(),
  role: z.literal("user"),
  metadata: z
    .object({
      questionId: z.uuid().optional(),
      confidence: z.number().int().min(1).max(4).optional(),
      readingSectionId: z.uuid().optional(),
    })
    .optional(),
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
  /** The mode a new Chat's Study session starts in; learn without it. */
  mode: z.enum(["learn", "review", "practice", "results"]).optional(),
  /** The graded Mock exam a new results session goes through. */
  mockId: z.uuid().optional(),
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

/** A Material whose attaching Chats are counted. */
export const attachedMaterialSchema = z.object({ materialId: z.uuid() });

/** Deleting a Chat from its "…" menu. */
export const deleteChatSchema = chatIdSchema.extend({
  /** The Student is on the Chat's page, so they land on a new Chat. */
  leave: z.boolean().optional(),
});

/** Opening a source in the source pane (`SourceRequest`). */
export const openSourceSchema = z.object({
  courseId: z.uuid(),
  kind: z.enum(["section", "chunk"]),
  id: z.uuid(),
});

/** What the source pane shows for a source that is missing or not the Course's. */
export const sourceNotFoundMessage = "This source could not be found.";
