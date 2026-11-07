import { isToolUIPart } from "ai";
import { stepSummary } from "@/features/chat/domain/reply-steps";
import type { ChatUIMessage } from "@/features/chat/types";

/**
 * How the stored history is cut down before the model rereads it (#251).
 * The stored messages stay as they are.
 */

/** The Student messages whose replies keep their tool results whole. */
const RECENT_STUDENT_MESSAGES = 3;

/**
 * The history the model receives: each tool result older than the
 * third-newest Student message becomes its one-line step summary, and a
 * Material attached to any message but the newest becomes the line
 * "[Attached: <name>]", which `searchMaterials` finds once it is parsed.
 */
export function modelHistory(history: ChatUIMessage[]): ChatUIMessage[] {
  const studentIndexes = history.flatMap(({ role }, index) =>
    role === "user" ? [index] : [],
  );
  const newest = studentIndexes.at(-1);
  const cutoff = studentIndexes.at(-RECENT_STUDENT_MESSAGES) ?? 0;
  return history.map((message, index) => {
    if (message.role === "user" && index !== newest) {
      return { ...message, parts: message.parts.map(attachedAsText) };
    }
    if (message.role === "assistant" && index < cutoff) {
      return { ...message, parts: message.parts.map(resultAsSummary) };
    }
    return message;
  });
}

type Part = ChatUIMessage["parts"][number];

function attachedAsText(part: Part): Part {
  return part.type === "data-material"
    ? { type: "text", text: `[Attached: ${part.data.name}]` }
    : part;
}

function resultAsSummary(part: Part): Part {
  return isToolUIPart(part) && part.state === "output-available"
    ? { ...part, output: stepSummary(part) }
    : part;
}
