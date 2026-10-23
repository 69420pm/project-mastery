import "server-only";
import { randomUUID } from "node:crypto";
import {
  consumeStream,
  createUIMessageStreamResponse,
  hasToolCall,
  isStepCount,
  streamText,
  toUIMessageStream,
  validateUIMessages,
  type LanguageModelUsage,
  type ToolSet,
} from "ai";
import { after } from "next/server";
import { chatReplySettings } from "@/features/chat/ai/reply";
import { messageGist } from "@/features/chat/domain/chat-label";
import { replyUsage } from "@/features/chat/domain/reply-usage";
import {
  chatMessageMetadataSchema,
  chatNotFoundMessage,
  chatRequestSchema,
} from "@/features/chat/schemas";
import {
  cancelReply,
  createChat,
  deleteChat,
  findChat,
  hasMessage,
  loadMessages,
  saveMessage,
  saveReply,
  startReply,
  type StoredChat,
} from "@/features/chat/server/chat-store";
import {
  attachmentRefusal,
  loadAttachedMaterials,
  materialsTooLargeMessage,
  materialsUnavailableMessage,
  sentMaterials,
  toModelMessages,
  type LoadedMaterial,
} from "@/features/chat/server/attached-materials";
import { titleChat } from "@/features/chat/server/chat-title";
import type { ChatUIMessage } from "@/features/chat/types";
import {
  courseNotFoundMessage,
  getCourseWith,
  materialReferenceSchema,
} from "@/features/courses/server";
import {
  isAnswerable,
  recordAnswer,
  startTutoring,
  TutorToolError,
} from "@/features/study/server";
import {
  checkDailyLimit,
  dailyLimitReachedMessage,
  recordReplyUsage,
} from "@/features/usage/server";
import { tokenUsage } from "@/lib/ai/cost";
import { answeringModel } from "@/lib/ai/models";
import { messageText, replyErrorMessage } from "@/lib/ai/reply";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import type { Supabase } from "@/lib/supabase/types";
import { flushTraces, withTraceAttributes } from "@/lib/tracing";

/**
 * Handles a Student's message to a Chat and streams the AI's reply, following
 * the AI SDK message persistence guide. The stages, in order:
 *
 * 1. require the signed-in Student
 * 2. validate the request: the message and a Chat
 *    the Student owns, or a new Chat in a Course the Student owns
 * 3. refuse at the Daily limit, before any model call
 * 4. create the Chat on its first message, or mark the new reply as the
 *    Chat's latest, then store the Student's message, and an answer from a
 *    task card on its question, which must still be open
 * 5. stream the reply from the full stored history
 * 6. on end, record the call's usage and store the reply with its model,
 *    unless a newer request has started a reply since
 * 7. name an untitled Chat after its reply
 *
 * Refusals are plain-text responses, which `useChat` shows as the error
 * message.
 */
export async function handleChatRequest(request: Request): Promise<Response> {
  const user = await getUser();
  if (!user) return refuse(401, "Sign in to chat with the AI.");

  const response = await respondInChat({
    request,
    supabase: await createClient(),
    userId: user.id,
  });
  after(flushTraces);
  return response;
}

/**
 * `handleChatRequest` from stage 2 on, as the Student whose session client
 * `supabase` is. Smoke checks call it with a client they signed in.
 */
export async function respondInChat({
  request,
  supabase,
  userId,
}: {
  request: Request;
  supabase: Supabase;
  userId: string;
}): Promise<Response> {
  const parsed = chatRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return refuse(400, parsed.error.issues[0]?.message ?? "Invalid request.");
  }
  const { chatId, courseId, message } = parsed.data;

  const existing = await findChat(supabase, chatId);
  if (!existing && !courseId) return refuse(404, chatNotFoundMessage);
  if (!existing && !(await getCourseWith(supabase, courseId!))) {
    return refuse(404, courseNotFoundMessage);
  }

  // A stored message, as when retrying, is answered as stored: its
  // Materials may have been deleted since.
  if (!existing || !(await hasMessage(supabase, existing.id, message.id))) {
    const refusal = await attachmentRefusal(
      supabase,
      message,
      existing?.courseId ?? courseId!,
    );
    if (refusal) return refuse(400, refusal);
  }

  const dailyLimit = await checkDailyLimit(supabase);
  if (dailyLimit.level === "reached") {
    return refuse(429, dailyLimitReachedMessage);
  }

  // Refused before the reply starts, which would make a reply still streaming
  // from an earlier request stale.
  const stored = existing ? await loadMessages(supabase, existing.id) : [];
  const resent = resentHistory(stored, message);
  if (resent === "refused") return refuse(409, alreadySentMessage);

  // An answer from a task card, for a question still open in this Chat.
  const questionId = resent ? undefined : message.metadata?.questionId;
  if (
    questionId &&
    !(existing && (await isAnswerable(supabase, existing.id, questionId)))
  ) {
    return refuse(409, questionClosedMessage);
  }

  // The reply's id, marked as the Chat's latest before the Student's message
  // is stored, so a stopped reply still ending from an earlier request can
  // never be kept after it.
  const replyId = randomUUID();
  const chat =
    existing ??
    (await createChat(supabase, chatId, { courseId: courseId!, replyId }));
  if (chat === "taken") return refuse(404, chatNotFoundMessage);
  // The Course was deleted since it was checked.
  if (chat === "no course") return refuse(404, courseNotFoundMessage);

  if (existing) await startReply(supabase, chat.id, replyId);

  const history =
    resent ??
    ((await saveStudentMessage(supabase, chat, message, !existing)) && [
      ...stored,
      message,
    ]);
  if (!history) {
    if (existing) {
      await cancelReply(supabase, chat.id, {
        replyId,
        previousReplyId: existing.latestReplyId,
      });
    }
    return refuse(409, alreadySentMessage);
  }
  if (questionId) {
    await recordAnswer(supabase, {
      questionId,
      messageId: message.id,
      text: messageText(message.parts),
    });
  }

  // After storing the message, so Retry can send it again.
  const materials = await loadAttachedMaterials(supabase, history);
  if (materials === "too large") return refuse(413, materialsTooLargeMessage);
  if (materials === "failed") return refuse(503, materialsUnavailableMessage);

  return streamReply({
    request,
    supabase,
    chat,
    userId,
    history,
    materials,
    replyId,
  });
}

/**
 * The most model calls one reply may take: tool steps to read KCs, a retry
 * after a malformed call, and the text.
 */
const MAX_STEPS = 5;

function refuse(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

const alreadySentMessage = "This message was already sent.";

const questionClosedMessage =
  "This question is already graded, so it takes no more answers.";

/**
 * The history as the model reads it: a Student's answer on a task card
 * starts with a line naming the question it answers, so the AI can grade
 * it.
 */
function withAnswerNotes(history: ChatUIMessage[]): ChatUIMessage[] {
  return history.map((message) => {
    const questionId = message.metadata?.questionId;
    if (message.role !== "user" || !questionId) return message;
    return {
      ...message,
      parts: [
        {
          type: "text",
          text: `[My answer on the card of question ${questionId}:]\n\n`,
        },
        ...message.parts,
      ],
    };
  });
}

/**
 * The history to answer when the message is already stored: when it is the
 * Chat's last Student message, as when regenerating or retrying a failed
 * reply, the history up to it, leaving out any reply stored after it, which
 * the new reply replaces once it is saved. "refused" when a later Student
 * message follows it, and null when it is not stored.
 */
function resentHistory(
  stored: ChatUIMessage[],
  message: ChatUIMessage,
): ChatUIMessage[] | "refused" | null {
  const index = stored.findIndex((m) => m.id === message.id);
  if (index === -1) return null;
  const later = stored.slice(index + 1);
  if (later.some((m) => m.role === "user")) return "refused";
  return stored.slice(0, index + 1);
}

/**
 * Stores the Student's new message. Returns false if its id is taken
 * elsewhere, deleting a new Chat so none is left empty.
 */
async function saveStudentMessage(
  supabase: Supabase,
  chat: StoredChat,
  message: ChatUIMessage,
  isNewChat: boolean,
): Promise<boolean> {
  const saved = await saveMessage(supabase, chat.id, message);
  if (!saved && isNewChat) await deleteChat(supabase, chat.id);
  return saved;
}

async function streamReply({
  request,
  supabase,
  chat,
  userId,
  history,
  materials,
  replyId,
}: {
  request: Request;
  supabase: Supabase;
  chat: StoredChat;
  userId: string;
  history: ChatUIMessage[];
  /** The files of the Materials the history references, by id. */
  materials: Map<string, LoadedMaterial>;
  replyId: string;
}) {
  const messages = await validateUIMessages<ChatUIMessage>({
    messages: history,
    metadataSchema: chatMessageMetadataSchema,
    dataSchemas: { material: materialReferenceSchema },
  });
  // Read on every reply, so the candidates and dates are always current.
  const tutoring = await startTutoring(supabase, chat.courseId, chat.id);
  const settings = chatReplySettings(tutoring.context);
  // What the provider reports when the call completes: its usage over all
  // steps and the model that answered, a gateway fallback when the primary
  // failed. A stopped or failed call reports neither.
  let reportedUsage: LanguageModelUsage | undefined;
  let modelId = settings.model;

  const result = withTraceAttributes(
    { userId, sessionId: chat.id, traceName: "chat-reply" },
    async () =>
      streamText({
        ...settings,
        messages: await toModelMessages(withAnswerNotes(messages), materials),
        tools: tutoring.tools,
        // A question on a task card waits for the Student's answer.
        stopWhen: [isStepCount(MAX_STEPS), hasToolCall("ask")],
        // A disconnect, such as Stop or a closed tab, aborts generation.
        abortSignal: request.signal,
        onError: ({ error }) => console.error("Chat reply failed:", error),
        onEnd: ({ totalUsage, response }) => {
          reportedUsage = totalUsage;
          modelId = answeringModel(settings, response.modelId);
        },
      }),
  );

  return createUIMessageStreamResponse({
    stream: toUIMessageStream<ToolSet, ChatUIMessage>({
      stream: (await result).stream,
      originalMessages: messages,
      generateMessageId: () => replyId,
      messageMetadata: ({ part }) =>
        // The context goes on `start`, before any tool call, so a streaming
        // reply can show it at once.
        part.type === "start"
          ? { modelId, tutorContext: tutoring.context }
          : part.type === "finish-step"
            ? { modelId: answeringModel(settings, part.response.modelId) }
            : part.type === "finish"
              ? {
                  usage: replyUsage(
                    modelId,
                    tokenUsage(part.totalUsage),
                    false,
                  ),
                }
              : undefined,
      onError: chatReplyErrorMessage,
      // Runs before the response ends, so the client sees the recorded usage
      // once the reply has finished.
      onEnd: async ({ responseMessage, isAborted, isCancelled, outcome }) => {
        const stopped = isAborted || isCancelled === true;
        await recordReplyUsage(supabase, {
          task: "chat",
          modelId,
          reported: reportedUsage,
          input: [
            settings.instructions,
            ...messages.map(({ parts }) => messageText(parts)),
          ].join("\n"),
          output: messageText(responseMessage.parts),
          files: sentMaterials(messages, materials),
          chatId: chat.id,
          replyId,
        });

        if (outcome.status === "failed") return;
        if (stopped && messageText(responseMessage.parts) === "") return;
        try {
          const kept = await saveReply(supabase, chat.id, history.at(-1)!.id, {
            ...responseMessage,
            id: replyId,
            metadata: {
              modelId,
              tutorContext: tutoring.context,
              ...(stopped && { stopped }),
            },
          });
          if (!kept) return;
        } catch (error) {
          console.error("Saving the Chat reply failed:", error);
          return;
        }

        // After the first reply, before the response ends, so the client
        // can show the title once the reply has finished.
        if (chat.title === null) {
          await titleChat(supabase, {
            chatId: chat.id,
            userId,
            firstMessage: messageGist(messages[0]?.parts ?? []),
          });
        }
      },
    }),
    // Lets `onEnd` run when the client disconnects mid-reply.
    consumeSseStream: consumeStream,
  });
}

/**
 * `replyErrorMessage`, where a call a tool refused also keeps its own
 * message, as one the model got wrong does. The Chat shows only text parts.
 */
function chatReplyErrorMessage(error: unknown): string {
  if (error instanceof TutorToolError) return error.message;
  return replyErrorMessage(error);
}
