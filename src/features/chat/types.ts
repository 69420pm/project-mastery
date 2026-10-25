import type { UIMessage } from "ai";
import type { MaterialReference } from "@/features/courses";
import type { ProblemFlag, SessionMode, TutorContext } from "@/features/study";

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

/**
 * What a message carries besides its parts: on a Student's message, the
 * question it answers on a question card; the rest the server attaches to an AI
 * message.
 */
export type ChatMessageMetadata = {
  /** The question a Student's message answers, sent from its question card. */
  questionId?: string;
  /** How sure the Student was in that answer, from 1 to 4. */
  confidence?: number;
  /** The Reading section a Student's "Done reading." is for, sent with Done. */
  readingSectionId?: string;
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
  /** The mode of its Study session. */
  mode: SessionMode;
  /** Whether its Study session has ended, which makes it read-only. */
  ended: boolean;
  /** The flags of the generated Problems its questions posed, by Problem id. */
  problemFlags: Record<string, ProblemFlag>;
};

/**
 * What the source pane opens: a Reading section by id, or a cited chunk's
 * Material at the chunk's first page.
 */
export type SourceRequest = {
  kind: "section" | "chunk";
  id: string;
  /** The reading card that opened a section, whose Done the pane shows. */
  cardId?: string;
};

/**
 * What the Chat's side slot shows, one at a time: a source, or a Topic's KC
 * graph after a rebuild, by Topic id.
 */
export type PaneRequest = SourceRequest | { kind: "topic"; id: string };

/** A source as the source pane shows it (`openSource`). */
export type ChatSource = {
  materialId: string;
  materialName: string;
  /** The page it opens at. */
  pageFrom: number;
  pageTo: number;
  /** A Reading section's mode and texts; null for a cited chunk. */
  reading: {
    mode: "original" | "annotated" | "study_text";
    annotations: Array<{ page: number; note: string }> | null;
    studyText: string | null;
  } | null;
};

/** A Chat as the sidebar lists it. */
export type ChatListItem = {
  id: string;
  /** The title, or the first message shortened (`chatLabel`). */
  label: string;
};
