import type { UIMessage } from "ai";
import type { MaterialReference } from "@/features/courses";
import type { TutorContext } from "@/features/study";

/** The tokens and cost of the AI call that wrote a reply. */
export type ReplyUsage = {
  /** All input tokens, cached ones included. */
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Whether the tokens were estimated, as for a stopped reply. */
  estimated: boolean;
};

/** What the server attaches to an AI message. */
export type ChatMessageMetadata = {
  /** The model that wrote the reply. */
  modelId?: string;
  /** Whether the reply was stopped before it ended. */
  stopped?: boolean;
  /**
   * The tutor context the reply was given. Sent on the stream's `start`
   * part; missing on replies from before it was saved.
   */
  tutorContext?: TutorContext;
  /**
   * The reply's tokens and cost. Sent on the stream's `finish` part, and
   * loaded from the reply's `ai_usage` record; missing on older replies.
   */
  usage?: ReplyUsage;
};

/** The custom data parts of Chat messages, by name without `data-`. */
type ChatDataParts = {
  /** A Material the Student attached to their message. */
  material: MaterialReference;
};

/** A message of a Chat, as `useChat` shows it and the database stores it. */
export type ChatUIMessage = UIMessage<ChatMessageMetadata, ChatDataParts>;

/** A stored Chat with its messages, for the Chat page. */
export type ChatWithMessages = {
  id: string;
  /** The Course the Chat belongs to. */
  courseId: string;
  title: string | null;
  messages: ChatUIMessage[];
};

/** A Chat as the sidebar lists it. */
export type ChatListItem = {
  id: string;
  /** The title, or the first message shortened (`chatLabel`). */
  label: string;
};
