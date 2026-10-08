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
  type ToolSet,
} from "ai";
import { after } from "next/server";
import { chatReplySettings } from "@/features/chat/ai/reply";
import {
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
  type StoredChat,
  type Supabase,
} from "@/features/chat/server/chat-store";
import type { ChatUIMessage } from "@/features/chat/types";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { flushTraces, withTraceAttributes } from "@/lib/tracing";

/**
 * Handles a Student's message to a Chat and streams the AI's reply, following
 * the AI SDK message persistence guide. The stages, in order:
 *
 * 1. require the signed-in Student
 * 2. validate the request: the message, and a Chat the Student owns or may create
 * 3. (Daily limit, #27: refuse before any model call)
 * 4. create the Chat on its first message, and store the Student's message
 * 5. stream the reply from the full stored history
 * 6. on end, store the reply with its model (and record usage, #27)
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
  const { chatId, newChat, message } = parsed.data;

  const supabase = await createClient();
  const existing = await findChat(supabase, chatId);
  if (!existing && !newChat) return refuse(404, chatNotFound);

  const chat = existing ?? (await createChat(supabase, chatId));
  if (!chat) return refuse(404, chatNotFound);

  const history = await addStudentMessage(supabase, chat, message, !existing);
  if (!history) return refuse(409, "This message was already sent.");

  return streamReply({ request, supabase, chat, userId: user.id, history });
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
  const modelId = settings.model;

  const result = withTraceAttributes(
    { userId, sessionId: chat.id, traceName: "chat-reply" },
    async () =>
      streamText({
        ...settings,
        messages: await convertToModelMessages(messages),
        // A disconnect, such as Stop or a closed tab, aborts generation.
        abortSignal: request.signal,
        onError: ({ error }) => console.error("Chat reply failed:", error),
      }),
  );
  after(flushTraces);

  return createUIMessageStreamResponse({
    stream: toUIMessageStream<ToolSet, ChatUIMessage>({
      stream: (await result).stream,
      originalMessages: messages,
      generateMessageId: randomUUID,
      messageMetadata: ({ part }) =>
        part.type === "start" ? { modelId } : undefined,
      onError: replyErrorMessage,
      onEnd: async ({ responseMessage, isAborted, isCancelled, outcome }) => {
        if (outcome.status === "failed") return;
        const stopped = isAborted || isCancelled === true;
        if (stopped && !hasText(responseMessage)) return;
        try {
          await saveMessage(supabase, chat.id, {
            ...responseMessage,
            metadata: { modelId, ...(stopped && { stopped }) },
          });
        } catch (error) {
          console.error("Saving the Chat reply failed:", error);
        }
      },
    }),
    // Lets `onEnd` run when the client disconnects mid-reply.
    consumeSseStream: consumeStream,
  });
}

function hasText(message: ChatUIMessage) {
  return message.parts.some((part) => part.type === "text" && part.text !== "");
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
