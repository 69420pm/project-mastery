import { aiTask } from "@/lib/ai/models";
import { tutorInstructions, type TutorContext } from "@/features/study/server";

/**
 * Call settings for the AI's reply in a Chat: the `chat` task's model, with
 * retries, fallbacks and telemetry, plus the tutor instructions with
 * `context`. The request handler and the `chat` eval both use it, so the
 * eval tests the real configuration:
 *
 *   streamText({ ...chatReplySettings(context), messages, tools })
 */
export function chatReplySettings(context: TutorContext) {
  return {
    ...aiTask("chat"),
    instructions: tutorInstructions(context),
  };
}
