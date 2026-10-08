import { modelName } from "@/lib/ai/model-name";
import { aiTask, modelChoices } from "@/lib/ai/models";
import type { ModelOption } from "@/features/chat/types";
import { CHAT_INSTRUCTIONS } from "./prompt";

/**
 * Call settings for the AI's reply in a Chat: the `chat` task's model for the
 * Student's choice (the default choice without one), with retries, fallbacks
 * and telemetry, plus the Chat instructions. The request handler and the
 * `chat` eval both use it, so the eval tests the real configuration:
 *
 *   streamText({ ...chatReplySettings(choice), messages })
 */
export function chatReplySettings(modelChoice?: string) {
  return { ...aiTask("chat", modelChoice), instructions: CHAT_INSTRUCTIONS };
}

/** The model choices the picker offers, in display order. */
export function chatModelOptions(): ModelOption[] {
  return modelChoices("chat").map(({ key, label, model }) => ({
    key,
    label,
    modelName: modelName(model),
  }));
}
