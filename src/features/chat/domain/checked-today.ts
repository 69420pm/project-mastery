import { getToolName, isToolUIPart } from "ai";
import type { ChatUIMessage } from "@/features/chat/types";

/**
 * How many KCs of the Course were checked today, as the line above a
 * Chat's messages says: those of the newest reply's tutor context, plus
 * those that reply graded since. Null before a reply with a context.
 */
export function checkedToday(messages: ChatUIMessage[]): number | null {
  const reply = messages.findLast(
    ({ role, metadata }) => role === "assistant" && metadata?.tutorContext,
  );
  const context = reply?.metadata?.tutorContext;
  if (!reply || !context) return null;
  const ids = new Set(context.session.checkedToday.map(({ id }) => id));
  for (const part of reply.parts) {
    if (
      !isToolUIPart(part) ||
      getToolName(part) !== "grade" ||
      part.state !== "output-available"
    ) {
      continue;
    }
    const kcs = (part.output as { kcs?: unknown }).kcs;
    if (!Array.isArray(kcs)) continue;
    for (const kc of kcs) {
      if (typeof kc?.id === "string") ids.add(kc.id);
    }
  }
  return ids.size;
}

/** Such as "Checked today: 4 KCs". */
export const checkedTodayText = (count: number) =>
  `Checked today: ${count} ${count === 1 ? "KC" : "KCs"}`;
