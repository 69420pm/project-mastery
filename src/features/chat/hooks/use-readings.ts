"use client";

import { useMemo, useState } from "react";
import { doneReadings } from "@/features/chat/domain/reply-steps";
import type { ChatUIMessage } from "@/features/chat/types";

/**
 * The Chat's reading cards: which are done (`doneReadings`), and whether a
 * message arrived while the Chat is open, not with the stored Chat, so its
 * reading card opens the pane on its own.
 */
export function useReadings(
  messages: ChatUIMessage[],
  storedMessages: ChatUIMessage[],
) {
  const done = useMemo(() => doneReadings(messages), [messages]);
  const [stored] = useState(() => new Set(storedMessages.map(({ id }) => id)));
  return { done, arrived: (messageId: string) => !stored.has(messageId) };
}
