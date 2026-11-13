import "server-only";
import {
  consumeStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  isToolUIPart,
  streamText,
  toUIMessageStream,
  validateUIMessages,
  type InferUIMessageChunk,
  type LanguageModelUsage,
  type ToolSet,
} from "ai";
import { after } from "next/server";
import { briefReplySettings } from "@/features/brief/ai/reply";
import { briefTools } from "@/features/brief/ai/tools";
import { isIntakeDone } from "@/features/brief/domain/intake";
import { askedChapterIds } from "@/features/brief/domain/old-exams";
import { replyMessageId } from "@/features/brief/domain/opening";
import { briefToolActions } from "@/features/brief/server/brief-tools";
import {
  briefMessageMetadataSchema,
  briefNotFoundMessage,
  briefRequestSchema,
} from "@/features/brief/schemas";
import {
  ensureBrief,
  loadContext,
  loadMessages,
  saveMessage,
} from "@/features/brief/server/brief-store";
import type { BriefUIMessage } from "@/features/brief/types";
import { courseMapPath } from "@/features/knowledge-map/server";
import {
  checkDailyLimit,
  dailyLimitReachedMessage,
  recordReplyUsage,
} from "@/features/usage/server";
import { answeringModel, textOnlyStep } from "@/lib/ai/models";
import { messageText, replyErrorMessage } from "@/lib/ai/reply";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import type { Supabase } from "@/lib/supabase/types";
import { flushTraces, withTraceAttributes } from "@/lib/tracing";

/**
 * Handles a Student's message in a Course's Brief and streams the AI's reply,
 * with the reply pieces the Chat handler shares. The stages, in order:
 *
 * 1. require the signed-in Student
 * 2. validate the request: the message and a Course the Student owns
 * 3. refuse at the Daily limit, before any model call
 * 4. create the Brief if needed, then store the Student's message
 * 5. stream the reply from the full stored history, with the stored answers
 *    and the Course's Materials in the instructions; the tools store what
 *    the Student answers
 * 6. on end, record the call's usage and store the reply, unless the
 *    Student has written since or the message already has a reply
 *
 * Refusals are plain-text responses, which `useChat` shows as the error
 * message.
 */
export async function handleBriefRequest(request: Request): Promise<Response> {
  const user = await getUser();
  if (!user) return refuse(401, "Sign in to tell the AI about your exam.");
  const response = await respondInBrief({
    request,
    supabase: await createClient(),
    userId: user.id,
  });
  after(flushTraces);
  return response;
}

/**
 * `handleBriefRequest` from stage 2 on, as the Student whose session client
 * `supabase` is. Smoke checks call it with a client they signed in.
 */
export async function respondInBrief({
  request,
  supabase,
  userId,
}: {
  request: Request;
  supabase: Supabase;
  userId: string;
}): Promise<Response> {
  const parsed = briefRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return refuse(400, parsed.error.issues[0]?.message ?? "Invalid request.");
  }
  const { courseId, message } = parsed.data;

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
    userId,
    history,
    replyId: replyMessageId(message.id),
  });
}

/**
 * The most model calls one reply may take: a tool step per kind of answer
 * (saveBrief, addNote, setExamScope), a retry after a malformed call, and
 * the text.
 */
const MAX_STEPS = 5;

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
  const context = await loadContext(supabase, courseId);
  if (!context) return refuse(404, briefNotFoundMessage);
  const studentTexts = messages
    .filter(({ role }) => role === "user")
    .map(({ parts }) => messageText(parts));
  const settings = briefReplySettings(context, courseMapPath(courseId));
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
        tools: briefTools(
          briefToolActions(
            supabase,
            courseId,
            context,
            studentTexts,
            askedChapterIds(
              messages,
              isIntakeDone(context.fields)
                ? []
                : context.materials.flatMap(({ chapters }) =>
                    chapters.map(({ id }) => id),
                  ),
            ),
          ),
        ),
        stopWhen: isStepCount(MAX_STEPS),
        // The last step writes text, so every reply answers the Student,
        // where the model lets a step be text-only.
        prepareStep: ({ steps }) =>
          steps.length === MAX_STEPS - 1
            ? textOnlyStep(settings.model)
            : undefined,
        // A disconnect, such as a closed tab, aborts generation.
        abortSignal: request.signal,
        onError: ({ error }) => console.error("Brief reply failed:", error),
        onEnd: ({ totalUsage, response }) => {
          reportedUsage = totalUsage;
          modelId = answeringModel(settings, response.modelId);
        },
      }),
  );

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
        await recordReplyUsage(supabase, {
          task: "brief",
          modelId,
          reported: reportedUsage,
          input: [
            settings.instructions,
            ...messages.map(({ parts }) => messageText(parts)),
          ].join("\n"),
          output: text,
        });

        // A reply cut off by a disconnect or a step's time limit is
        // dropped: the Brief has no Stop.
        // A reply that only called tools is stored, so the conversation
        // keeps the answers it saved and never has two Student turns in a
        // row.
        const empty = text === "" && !responseMessage.parts.some(isToolUIPart);
        if (outcome.status === "failed" || stopped || empty) return;
        try {
          // A reply is stored only right after the message it answers: a
          // late one, after the Student wrote again, would answer the wrong
          // message. Its id makes a second reply to one message a no-op.
          const latest = (await loadMessages(supabase, courseId)).at(-1);
          if (latest?.id !== messages.at(-1)?.id) return;
          await saveMessage(supabase, courseId, {
            ...responseMessage,
            id: replyId,
            metadata: { modelId },
          });
        } catch (error) {
          console.error("Saving the Brief reply failed:", error);
        }
      },
    }).pipeThrough(timeoutAsError(request.signal)),
    // Lets `onEnd` run when the client disconnects mid-reply.
    consumeSseStream: consumeStream,
  });
}

/** What the Student sees when a step ran past its time limit. */
export const replyTimeoutMessage =
  "The AI took too long to reply. Please try again.";

/**
 * Turns the abort a step's time limit causes into an error, which the
 * client shows with Retry; as an abort, the reply would just end. An abort
 * while `signal` is aborted is the client's own disconnect, and stays one.
 */
function timeoutAsError(signal: AbortSignal) {
  return new TransformStream<
    InferUIMessageChunk<BriefUIMessage>,
    InferUIMessageChunk<BriefUIMessage>
  >({
    transform(chunk, controller) {
      controller.enqueue(
        chunk.type === "abort" && !signal.aborted
          ? { type: "error", errorText: replyTimeoutMessage }
          : chunk,
      );
    },
  });
}
