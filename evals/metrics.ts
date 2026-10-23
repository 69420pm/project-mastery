/**
 * Metrics of Chats, scored in Langfuse on the session whose id is the Chat's
 * id (until M1 adds Study sessions). Pure, apart from `scoreChats`, which
 * writes through the `MetricsLangfuse` that tests replace.
 */
import { isMockReply } from "@/lib/ai/mock-provider";
import type { MetricsLangfuse, SessionScore } from "./langfuse";

/** One stored message of a Chat. */
export type MetricsMessage = {
  id: string;
  role: string;
  /** The stored UI message parts; only text parts count. */
  parts: unknown;
  createdAt: string;
};

export type MetricsChat = {
  id: string;
  createdAt: string;
  /** Oldest first. */
  messages: MetricsMessage[];
  /** The recorded cost of each AI reply, by reply (message) id. */
  replyCostUsd: ReadonlyMap<string, number>;
};

export type ChatMetrics = {
  /** The Student's words over all words, Student's and AI's. */
  student_word_share?: number;
  /** The share of AI turns whose text ends in a question. */
  ai_question_share?: number;
  /** The gaps between the Student's messages, each capped at 5 minutes. */
  active_minutes: number;
  /** The replies' cost in USD per active hour. */
  cost_per_active_hour?: number;
};

/** A gap between the Student's messages counts as active up to this long. */
const ACTIVE_GAP_CAP_MS = 5 * 60 * 1000;

function messageText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        part.type === "text" &&
        typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Ends in a question mark, past closing Markdown, brackets and quotes. */
const endsInQuestion = (text: string) => /\?[\s*_)\]"'`»”’]*$/.test(text);

/** Whether the Chat has a reply from a real model, and so was traced. */
export function hasRealReplies(chat: MetricsChat): boolean {
  return chat.messages.some((message) => {
    if (message.role !== "assistant") return false;
    const text = messageText(message.parts);
    return text !== "" && !isMockReply(text);
  });
}

export function chatMetrics(chat: MetricsChat): ChatMetrics {
  let studentWords = 0;
  let aiWords = 0;
  let aiTurns = 0;
  let aiQuestions = 0;
  let activeMs = 0;
  let lastStudentAt: number | undefined;
  let costUsd = 0;

  for (const message of chat.messages) {
    const text = messageText(message.parts);
    if (message.role === "user") {
      studentWords += wordCount(text);
      const at = Date.parse(message.createdAt);
      if (lastStudentAt !== undefined) {
        activeMs += Math.min(at - lastStudentAt, ACTIVE_GAP_CAP_MS);
      }
      lastStudentAt = at;
    } else if (message.role === "assistant") {
      costUsd += chat.replyCostUsd.get(message.id) ?? 0;
      if (text === "") continue;
      aiWords += wordCount(text);
      aiTurns++;
      if (endsInQuestion(text)) aiQuestions++;
    }
  }

  const words = studentWords + aiWords;
  const activeMinutes = activeMs / 60_000;
  return {
    student_word_share: words > 0 ? studentWords / words : undefined,
    ai_question_share: aiTurns > 0 ? aiQuestions / aiTurns : undefined,
    active_minutes: activeMinutes,
    cost_per_active_hour:
      activeMinutes > 0 ? costUsd / (activeMinutes / 60) : undefined,
  };
}

/** The Langfuse scores of one Chat; a metric without a value has none. */
export function chatScores(chat: MetricsChat): SessionScore[] {
  return Object.entries(chatMetrics(chat)).flatMap(([name, value]) =>
    value === undefined
      ? []
      : [{ sessionId: chat.id, name, value, timestamp: chat.createdAt }],
  );
}

/**
 * Scores every Chat with real-model replies; mock-provider Chats are
 * skipped, since they aren't traced.
 */
export async function scoreChats(
  langfuse: MetricsLangfuse,
  chats: MetricsChat[],
): Promise<{ scored: MetricsChat[]; skipped: number }> {
  const scored = chats.filter(hasRealReplies);
  await langfuse.writeSessionScores(scored.flatMap(chatScores));
  return { scored, skipped: chats.length - scored.length };
}
