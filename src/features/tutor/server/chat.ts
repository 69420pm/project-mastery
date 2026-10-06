import "server-only";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
} from "ai";
import { after } from "next/server";
import { z } from "zod";
import { TUTOR_INSTRUCTIONS } from "@/features/tutor/ai/instructions";
import { aiTask } from "@/lib/ai/models";
import { getUser } from "@/lib/auth/user";
import { flushTraces, withTraceAttributes } from "@/lib/tracing";

// The body `useChat` sends; messages are validated separately below.
const bodySchema = z.object({
  id: z.string().min(1).max(200).optional(),
  messages: z.array(z.unknown()).min(1).max(200),
});

/**
 * Streams a tutor reply to the chat UI (`useChat` from `@ai-sdk/react`).
 * Handles `POST /api/chat`.
 */
export async function handleTutorChat(request: Request): Promise<Response> {
  const user = await getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const messages = await safeValidateUIMessages({
    messages: body.data.messages,
  });
  if (!messages.success) {
    return Response.json({ error: "Invalid messages" }, { status: 400 });
  }

  // Export the trace once the response has finished streaming.
  after(flushTraces);

  return withTraceAttributes(
    { userId: user.id, sessionId: body.data.id, traceName: "tutor-chat" },
    async () => {
      const result = streamText({
        ...aiTask("tutor"),
        instructions: TUTOR_INSTRUCTIONS,
        messages: await convertToModelMessages(messages.data),
      });
      return createUIMessageStreamResponse({
        stream: toUIMessageStream({
          stream: result.stream,
          originalMessages: messages.data,
        }),
      });
    },
  );
}
