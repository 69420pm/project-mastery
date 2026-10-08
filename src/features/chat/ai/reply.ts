import { aiTask } from "@/lib/ai/models";
import { CHAT_INSTRUCTIONS } from "./prompt";

/**
 * Call settings for the AI's reply in a Chat: the `chat` task's model for the
 * Student's choice, with retries, fallbacks and telemetry, plus the Chat
 * instructions. The request handler and the `chat` eval both use it, so the
 * eval tests the real configuration:
 *
 *   streamText({ ...chatReplySettings(choice), messages })
 */
export function chatReplySettings(modelChoice: string) {
  return { ...aiTask("chat", modelChoice), instructions: CHAT_INSTRUCTIONS };
}
