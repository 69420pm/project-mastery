import { aiTask } from "@/lib/ai/models";
import { tutorInstructions, type TutorContext } from "@/features/study/server";

/**
 * Call settings for the AI's reply in a Chat: the `chat` task's model, with
 * retries, fallbacks and telemetry, plus the tutor instructions with
 * `context`, as the request handler uses them:
 *
 *   streamText({ ...chatReplySettings(context), messages, tools })
 */
export function chatReplySettings(context: TutorContext) {
  return {
    ...aiTask("chat"),
    instructions: tutorInstructions(context),
  };
}
