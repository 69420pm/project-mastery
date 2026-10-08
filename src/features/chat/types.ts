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
  /** The key of the Chat's last model choice. */
  modelChoice: string;
  messages: ChatUIMessage[];
};

/** A model choice as the picker shows it. The client knows only the key. */
export type ModelOption = {
  key: string;
  /** Fast, Balanced or Thorough. */
  label: string;
  /** The model's name, shown under the label. */
  modelName: string;
};

/** A Chat as the sidebar lists it. */
export type ChatListItem = {
  id: string;
  /** The title, or the first message shortened (`chatLabel`). */
  label: string;
};
