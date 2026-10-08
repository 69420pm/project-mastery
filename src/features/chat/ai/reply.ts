import { modelName } from "@/lib/ai/model-name";
import {
  aiTask,
  defaultModelChoice,
  modelChoices,
  type ModelChoiceKey,
} from "@/lib/ai/models";
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

/**
 * The model choice of a new Chat: the `chat` task's default. The database's
 * `chats.model_choice` default repeats it for rows inserted without one, but
 * the handler always sets the choice.
 */
export const DEFAULT_MODEL_CHOICE = defaultModelChoice("chat");

/**
 * The choice a Chat answers with: `key` while it is offered, otherwise the
 * default, as for a stored choice that Google mode does not offer.
 */
export function offeredModelChoice(
  key: string | undefined,
): ModelChoiceKey<"chat"> {
  const offered = modelChoices("chat").find((choice) => choice.key === key);
  return (
    (offered?.key as ModelChoiceKey<"chat"> | undefined) ?? DEFAULT_MODEL_CHOICE
  );
}

/** The model choices the picker offers, in display order. */
export function chatModelOptions(): ModelOption[] {
  return modelChoices("chat").map(({ key, label, model }) => ({
    key,
    label,
    modelName: modelName(model),
  }));
}
