import type { ModelMessage } from "ai";
import { aiTask } from "@/lib/ai/models";
import {
  renderTutorContext,
  TUTOR_INSTRUCTIONS,
  type TutorContext,
} from "@/features/study/server";

/**
 * Call settings for the AI's reply in a Chat: the `chat` task's model, with
 * retries, fallbacks and telemetry, plus the static tutor instructions, as
 * the request handler uses them:
 *
 *   streamText({ ...chatReplySettings(), messages: withTutorContext(…), tools })
 */
export function chatReplySettings() {
  return { ...aiTask("chat"), instructions: TUTOR_INSTRUCTIONS };
}

/**
 * The model messages with the tutor context as a text block in front of
 * the newest Student message. Only that message carries it, so the
 * instructions and the earlier history stay the same from reply to reply.
 */
export function withTutorContext(
  messages: ModelMessage[],
  context: TutorContext,
): ModelMessage[] {
  const index = messages.findLastIndex(({ role }) => role === "user");
  if (index === -1) return messages;
  const block = { type: "text" as const, text: renderTutorContext(context) };
  return messages.map((message, at) => {
    if (at !== index || message.role !== "user") return message;
    const content =
      typeof message.content === "string"
        ? [{ type: "text" as const, text: message.content }]
        : message.content;
    return { ...message, content: [block, ...content] };
  });
}
