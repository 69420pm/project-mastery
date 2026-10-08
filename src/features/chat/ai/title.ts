import { aiTask } from "@/lib/ai/models";

const TITLE_INSTRUCTIONS = `You name Chats in a study app. Given the Student's first message in a Chat, reply with a short title for the Chat: at most six words, in the language of the message, naming the subject or problem. Reply with the title only, without quotes, Markdown or a final period.`;

/**
 * Call settings for naming a Chat with the `title` task:
 *
 *   generateText({ ...chatTitleSettings(), prompt: firstMessage })
 */
export function chatTitleSettings() {
  return { ...aiTask("title"), instructions: TITLE_INSTRUCTIONS };
}
