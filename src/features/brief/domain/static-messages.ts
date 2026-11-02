import type { BriefUIMessage } from "@/features/brief/types";

/** The `model_id` stored with a static message, which no model wrote. */
export const STATIC_MODEL_ID = "static";

/**
 * The conversation shown with the static messages that were stored after it,
 * such as the old-exam question that a refresh posts, appended at the
 * end. Static messages have stable ids, so one already shown is not repeated.
 */
export function withNewStaticMessages(
  shown: BriefUIMessage[],
  stored: BriefUIMessage[],
): BriefUIMessage[] {
  const shownIds = new Set(shown.map(({ id }) => id));
  const added = stored.filter(
    (message) =>
      message.metadata?.modelId === STATIC_MODEL_ID &&
      !shownIds.has(message.id),
  );
  return added.length === 0 ? shown : [...shown, ...added];
}
