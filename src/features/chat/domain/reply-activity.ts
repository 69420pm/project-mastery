import { messageText } from "@/lib/ai/reply";
import type { ChatUIMessage } from "@/features/chat/types";

/** What the AI is doing while a tutor tool runs, by tool name. */
const TOOL_ACTIVITY: Record<string, string> = {
  getTopic: "Reading your knowledge map…",
  findProblems: "Looking for problems…",
  remember: "Making a note…",
  ask: "Writing a question…",
  showReading: "Choosing a reading…",
  grade: "Grading your answer…",
  setStage: "Moving on…",
};

/** What the AI is doing when it has not said a word yet. */
export const THINKING = "Thinking…";

/**
 * The line that stands in for an AI reply that is on its way and has no text
 * yet: the tool it is using, otherwise "Thinking…". Null once the reply has
 * text, which replaces the line.
 */
export function replyActivity(parts: ChatUIMessage["parts"]): string | null {
  if (messageText(parts) !== "") return null;
  const tool = parts.findLast((part) => part.type.startsWith("tool-"));
  const name = tool?.type.slice("tool-".length) ?? "";
  return TOOL_ACTIVITY[name] ?? THINKING;
}
