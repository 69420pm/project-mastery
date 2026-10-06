import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
} from "ai";
import { after } from "next/server";
import { z } from "zod";
import { aiTask } from "@/lib/ai/models";
import { TUTOR_INSTRUCTIONS } from "@/lib/ai/tutor";
import { flushTraces, withTraceAttributes } from "@/lib/tracing";

// Streaming answers, plus retries on rate limits, outlast the default timeout.
export const maxDuration = 60;

// The body `useChat` sends; messages are validated separately below.
const bodySchema = z.object({
  id: z.string().min(1).max(200).optional(),
  messages: z.array(z.unknown()).min(1).max(200),
});

/** Streams a tutor reply to the chat UI (`useChat` from `@ai-sdk/react`). */
export async function POST(request: Request) {
  // TODO(auth): return 401 without a Supabase session once auth lands, and
  // pass the user's id as `userId` to the trace attributes below.
  const userId = undefined;

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
    { userId, sessionId: body.data.id, traceName: "tutor-chat" },
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
