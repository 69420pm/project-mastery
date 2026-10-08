import "server-only";
import { randomUUID } from "node:crypto";
import {
  APICallError,
  RetryError,
  consumeStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  validateUIMessages,
  type LanguageModelUsage,
  type ToolSet,
} from "ai";
import { after } from "next/server";
import { chatReplySettings } from "@/features/chat/ai/reply";
import {
  DEFAULT_MODEL_CHOICE,
  chatMessageMetadataSchema,
  chatRequestSchema,
} from "@/features/chat/schemas";
import {
  createChat,
  deleteChat,
  deleteMessages,
  findChat,
  loadMessages,
  saveMessage,
  setModelChoice,
  type StoredChat,
  type Supabase,
} from "@/features/chat/server/chat-store";
import { titleChat } from "@/features/chat/server/chat-title";
import type { ChatUIMessage } from "@/features/chat/types";
import {
  checkDailyLimit,
  dailyLimitReachedMessage,
  recordAiUsage,
} from "@/features/usage/server";
import { estimatedUsage, tokenUsage } from "@/lib/ai/cost";
import { answeringModel, modelChoices } from "@/lib/ai/models";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { flushTraces, withTraceAttributes } from "@/lib/tracing";

/**
 * Handles a Student's message to a Chat and streams the AI's reply, following
 * the AI SDK message persistence guide. The stages, in order:
 *
 * 1. require the signed-in Student
 * 2. validate the request: the message, an offered model choice, and a Chat
 *    the Student owns or may create
 * 3. refuse at the Daily limit, before any model call
 * 4. create the Chat on its first message, store the Student's message and
 *    the Chat's model choice
 * 5. stream the reply from the full stored history
 * 6. on end, store the reply with its model and record the call's usage
 * 7. name an untitled Chat after its reply
 *
 * Refusals are plain-text responses, which `useChat` shows as the error
 * message.
 */
export async function handleChatRequest(request: Request): Promise<Response> {
  const user = await getUser();
  if (!user) return refuse(401, "Sign in to chat with the AI.");

  const parsed = chatRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return refuse(400, parsed.error.issues[0]?.message ?? "Invalid request.");
  }
  const { chatId, newChat, modelChoice, message } = parsed.data;

  const offered = modelChoices("chat");
  const isOffered = (key: string) =>
    offered.some((choice) => choice.key === key);
  if (modelChoice !== undefined && !isOffered(modelChoice)) {
    const labels = offered.map(({ label }) => label);
    return refuse(
      400,
      `This model is not available. Choose ${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}.`,
    );
  }

  const supabase = await createClient();
  const existing = await findChat(supabase, chatId);
  if (!existing && !newChat) return refuse(404, chatNotFound);

  const dailyLimit = await checkDailyLimit(supabase);
  if (dailyLimit.level === "reached") {
    return refuse(429, dailyLimitReachedMessage);
  }

  const chat =
    existing ??
    (await createChat(supabase, chatId, modelChoice ?? DEFAULT_MODEL_CHOICE));
  if (!chat) return refuse(404, chatNotFound);

  const history = await addStudentMessage(supabase, chat, message, !existing);
  if (!history) return refuse(409, "This message was already sent.");

  // The choice applies from this message on. A stored choice that is no
  // longer offered, as in Google mode, falls back to the default.
  const choice =
    modelChoice ??
    (isOffered(chat.modelChoice) ? chat.modelChoice : DEFAULT_MODEL_CHOICE);
  if (existing) await setModelChoice(supabase, chat.id, choice);

  return streamReply({
    request,
    supabase,
    chat: { ...chat, modelChoice: choice },
    userId: user.id,
    history,
  });
}

const chatNotFound = "This chat does not exist.";

function refuse(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * Stores the Student's message and returns the history to answer. When the
 * message is already the Chat's last Student message, as when retrying a
 * failed reply, any reply stored after it is dropped instead. Returns null if
 * the message id is taken elsewhere.
 */
async function addStudentMessage(
  supabase: Supabase,
  chat: StoredChat,
  message: ChatUIMessage,
  isNewChat: boolean,
): Promise<ChatUIMessage[] | null> {
  const stored = await loadMessages(supabase, chat.id);
  const index = stored.findIndex((m) => m.id === message.id);
  if (index !== -1) {
    const later = stored.slice(index + 1);
    if (later.some((m) => m.role === "user")) return null;
    await deleteMessages(
      supabase,
      later.map((m) => m.id),
    );
    return stored.slice(0, index + 1);
  }

  const saved = await saveMessage(supabase, chat.id, message);
  if (!saved) {
    // Never leave an empty Chat behind.
    if (isNewChat) await deleteChat(supabase, chat.id);
    return null;
  }
  return [...stored, message];
}

async function streamReply({
  request,
  supabase,
  chat,
  userId,
  history,
}: {
  request: Request;
  supabase: Supabase;
  chat: StoredChat;
  userId: string;
  history: ChatUIMessage[];
}) {
  const messages = await validateUIMessages<ChatUIMessage>({
    messages: history,
    metadataSchema: chatMessageMetadataSchema,
  });
  const settings = chatReplySettings(chat.modelChoice);
  // What the provider reports when the call completes: its usage and the
  // model that answered, a gateway fallback when the primary failed. An
  // aborted call reports neither.
  let reportedUsage: LanguageModelUsage | undefined;
  let modelId = settings.model;

  const result = withTraceAttributes(
    { userId, sessionId: chat.id, traceName: "chat-reply" },
    async () =>
      streamText({
        ...settings,
        messages: await convertToModelMessages(messages),
        // A disconnect, such as Stop or a closed tab, aborts generation.
        abortSignal: request.signal,
        onError: ({ error }) => console.error("Chat reply failed:", error),
        onEnd: ({ usage, response }) => {
          reportedUsage = usage;
          modelId = answeringModel(settings, response.modelId);
        },
      }),
  );
  after(flushTraces);

  return createUIMessageStreamResponse({
    stream: toUIMessageStream<ToolSet, ChatUIMessage>({
      stream: (await result).stream,
      originalMessages: messages,
      generateMessageId: randomUUID,
      messageMetadata: ({ part }) =>
        part.type === "start"
          ? { modelId }
          : part.type === "finish-step"
            ? { modelId: answeringModel(settings, part.response.modelId) }
            : undefined,
      onError: replyErrorMessage,
      // Runs before the response ends, so the client sees the recorded usage
      // once the reply has finished.
      onEnd: async ({ responseMessage, isAborted, isCancelled, outcome }) => {
        const stopped = isAborted || isCancelled === true;
        // A stopped call reports no usage, so its cost is estimated from the
        // text sent and received. Otherwise stopping would dodge the limit.
        const usage = reportedUsage
          ? { usage: tokenUsage(reportedUsage) }
          : stopped
            ? {
                usage: estimatedUsage({
                  input: [
                    settings.instructions,
                    ...messages.map(messageText),
                  ].join("\n"),
                  output: messageText(responseMessage),
                }),
                estimated: true,
              }
            : undefined;
        if (usage) {
          try {
            await recordAiUsage(supabase, {
              task: "chat",
              modelId,
              ...usage,
              chatId: chat.id,
            });
          } catch (error) {
            console.error("Recording the Chat reply's usage failed:", error);
          }
        }

        if (outcome.status === "failed") return;
        if (stopped && !hasText(responseMessage)) return;
        try {
          await saveMessage(supabase, chat.id, {
            ...responseMessage,
            metadata: { modelId, ...(stopped && { stopped }) },
          });
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
            firstMessage: messageText(messages[0]),
          });
        }
      },
    }),
    // Lets `onEnd` run when the client disconnects mid-reply.
    consumeSseStream: consumeStream,
  });
}

function messageText(message: ChatUIMessage | undefined): string {
  return (message?.parts ?? [])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

function hasText(message: ChatUIMessage) {
  return messageText(message) !== "";
}

function statusCode(error: unknown): number | undefined {
  if (RetryError.isInstance(error)) return statusCode(error.lastError);
  if (APICallError.isInstance(error)) return error.statusCode;
  return undefined;
}

/** The error the Student sees when a reply fails mid-stream. */
function replyErrorMessage(error: unknown): string {
  return statusCode(error) === 429
    ? "The AI is busy right now. Please try again in a moment."
    : "The AI could not reply. Please try again.";
}
