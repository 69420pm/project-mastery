import type { ChatUIMessage } from "@/features/chat/types";

/** The text of a message's parts, joined, without any non-text parts. */
export function messageText(parts: ChatUIMessage["parts"]): string {
  return parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}
