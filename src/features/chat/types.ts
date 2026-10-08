import type { UIMessage } from "ai";

/** What the server attaches to an AI message. */
export type ChatMessageMetadata = {
  /** The model that wrote the reply. */
  modelId?: string;
  /** Whether the reply was stopped before it ended. */
  stopped?: boolean;
};

/** A message of a Chat, as `useChat` shows it and the database stores it. */
export type ChatUIMessage = UIMessage<ChatMessageMetadata>;

/** A stored Chat with its messages, for the Chat page. */
export type ChatWithMessages = {
  id: string;
  title: string | null;
  messages: ChatUIMessage[];
};
