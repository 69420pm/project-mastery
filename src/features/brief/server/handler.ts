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
import { briefReplySettings } from "@/features/brief/ai/reply";
import {
  briefMessageMetadataSchema,
  briefNotFoundMessage,
  briefRequestSchema,
} from "@/features/brief/schemas";
import { messageText } from "@/features/brief/domain/message-text";
import {
  ensureBrief,
  loadMessages,
  saveMessage,
} from "@/features/brief/server/brief-store";
import type { BriefUIMessage } from "@/features/brief/types";
import {
  checkDailyLimit,
  dailyLimitReachedMessage,
  recordAiUsage,
} from "@/features/usage/server";
import { estimatedUsage, tokenUsage } from "@/lib/ai/cost";
import { answeringModel } from "@/lib/ai/models";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import type { Supabase } from "@/lib/supabase/types";
import { flushTraces, withTraceAttributes } from "@/lib/tracing";

/**
 * Handles a Student's message in a Course's Brief and streams the AI's reply,
 * following the Chat handler. The stages, in order:
 *
 * 1. require the signed-in Student
 * 2. validate the request: the message and a Course the Student owns
 * 3. refuse at the Daily limit, before any model call
 * 4. create the Brief if needed, then store the Student's message
 * 5. stream the reply from the full stored history
 * 6. on end, record the call's usage and store the reply
 *
 * Refusals are plain-text responses, which `useChat` shows as the error
 * message.
 */
export async function handleBriefRequest(request: Request): Promise<Response> {
  const user = await getUser();
  if (!user) return refuse(401, "Sign in to tell the AI about your exam.");

  const parsed = briefRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return refuse(400, parsed.error.issues[0]?.message ?? "Invalid request.");
  }
  const { courseId, message } = parsed.data;

  const supabase = await createClient();
  const dailyLimit = await checkDailyLimit(supabase);
  if (dailyLimit.level === "reached") {
    return refuse(429, dailyLimitReachedMessage);
  }

  if (!(await ensureBrief(supabase, courseId))) {
    return refuse(404, briefNotFoundMessage);
  }

  const history = await addStudentMessage(supabase, courseId, message);
  if (!history) return refuse(409, "This message was already sent.");

  return streamReply({
    request,
    supabase,
    courseId,
    userId: user.id,
    history,
    replyId: randomUUID(),
  });
}

function refuse(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * Stores the Student's message and returns the history to answer, which ends
 * with it. When the message is already the last one stored, as when retrying
 * a failed reply, it is answered as stored. Returns null if the id is taken
 * by an earlier message or someone else's.
 */
async function addStudentMessage(
  supabase: Supabase,
  courseId: string,
  message: BriefUIMessage,
): Promise<BriefUIMessage[] | null> {
  const stored = await loadMessages(supabase, courseId);
  if (stored.at(-1)?.id === message.id) return stored;

  if (!(await saveMessage(supabase, courseId, message))) return null;
  return [...stored, message];
}

async function streamReply({
  request,
  supabase,
  courseId,
  userId,
  history,
  replyId,
}: {
  request: Request;
  supabase: Supabase;
  courseId: string;
  userId: string;
  history: BriefUIMessage[];
  replyId: string;
}) {
  const messages = await validateUIMessages<BriefUIMessage>({
    messages: history,
    metadataSchema: briefMessageMetadataSchema,
  });
  const settings = briefReplySettings();
  // What the provider reports when the call completes. A stopped or failed
  // call reports neither.
  let reportedUsage: LanguageModelUsage | undefined;
  let modelId = settings.model;

  const result = withTraceAttributes(
    { userId, sessionId: courseId, traceName: "brief-reply" },
    async () =>
      streamText({
        ...settings,
        messages: await convertToModelMessages(messages),
        // A disconnect, such as a closed tab, aborts generation.
        abortSignal: request.signal,
        onError: ({ error }) => console.error("Brief reply failed:", error),
        onEnd: ({ usage, response }) => {
          reportedUsage = usage;
          modelId = answeringModel(settings, response.modelId);
        },
      }),
  );
  after(flushTraces);

  return createUIMessageStreamResponse({
    stream: toUIMessageStream<ToolSet, BriefUIMessage>({
      stream: (await result).stream,
      originalMessages: messages,
      generateMessageId: () => replyId,
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
        const text = messageText(responseMessage.parts);
        // A stopped or failed call reports no usage, so its cost is
        // estimated from the text sent and received. Otherwise closing the
        // tab would dodge the limit.
        const usage = reportedUsage
          ? { usage: tokenUsage(reportedUsage) }
          : {
              usage: estimatedUsage({
                input: [
                  settings.instructions,
                  ...messages.map(({ parts }) => messageText(parts)),
                ].join("\n"),
                output: text,
              }),
              estimated: true,
            };
        try {
          await recordAiUsage(supabase, {
            task: "brief",
            modelId,
            ...usage,
          });
        } catch (error) {
          console.error("Recording the Brief reply's usage failed:", error);
        }

        // A reply cut off by a disconnect is dropped: the Brief has no Stop.
        if (outcome.status === "failed" || stopped || text === "") return;
        try {
          await saveMessage(supabase, courseId, {
            ...responseMessage,
            id: replyId,
            metadata: { modelId },
          });
        } catch (error) {
          console.error("Saving the Brief reply failed:", error);
        }
      },
    }),
    // Lets `onEnd` run when the client disconnects mid-reply.
    consumeSseStream: consumeStream,
  });
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
