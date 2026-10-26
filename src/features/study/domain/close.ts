/**
 * The close of an ended Study session (#187): what its `close` call reads,
 * and the guard that keeps a condensed Memory from dropping pinned lines.
 */

/** A Memory longer than this is condensed by the close call. */
export const CONDENSE_MEMORY_FROM = 3_000;

/** What a session's close is built from, as stored. */
export type CloseSource = {
  /** The session's mode: learn, review, practice or results. */
  mode: string;
  /** The session's Topic's name; null without one. */
  topicName: string | null;
  /** The Chat's messages, oldest first, with their stored parts. */
  messages: Array<{ role: string; parts: unknown }>;
  questions: Array<{
    prompt: string;
    answer: string | null;
    attempts: Array<{ kcName: string; result: string; help: string }>;
  }>;
  /** The Topic's current Topic note; null without one. */
  topicNote: string | null;
  memory: string;
};

/** What the close call reads. */
export type CloseInput = {
  mode: string;
  topic: string | null;
  /** The messages' text, tool calls and other parts left out. */
  transcript: Array<{ role: "student" | "tutor"; text: string }>;
  questions: CloseSource["questions"];
  topicNote: string | null;
  memory: string;
  /** Whether the call writes a Topic note: learn sessions with a Topic. */
  writesTopicNote: boolean;
  /** Whether the call condenses the Memory, once it is long. */
  condensesMemory: boolean;
};

/** The close call's notes, checked and trimmed to what the session gets. */
export type CloseNotes = {
  sessionNote: string;
  topicNote: string | null;
  memoryLines: string[];
  condensedMemory: string | null;
};

/** The text parts of a message's stored parts, joined. */
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
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * The close call's input; null when the session has no Student message,
 * which gets no call.
 */
export function buildCloseInput(source: CloseSource): CloseInput | null {
  if (!source.messages.some(({ role }) => role === "user")) return null;
  const transcript = source.messages
    .filter(({ role }) => role === "user" || role === "assistant")
    .map(({ role, parts }) => ({
      role: role === "user" ? ("student" as const) : ("tutor" as const),
      text: messageText(parts),
    }))
    .filter(({ text }) => text !== "");
  const writesTopicNote = source.mode === "learn" && source.topicName !== null;
  return {
    mode: source.mode,
    topic: source.topicName,
    transcript,
    questions: source.questions,
    topicNote: writesTopicNote ? source.topicNote : null,
    memory: source.memory,
    writesTopicNote,
    condensesMemory: source.memory.length > CONDENSE_MEMORY_FROM,
  };
}

/** The Memory's pinned lines: those starting with `!`, trimmed. */
export function pinnedLines(memory: string): string[] {
  return memory
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("!"));
}

/** Whether every pinned line of `memory` is in `condensed` word for word. */
export function keepsPinnedLines(memory: string, condensed: string): boolean {
  return pinnedLines(memory).every((line) => condensed.includes(line));
}

/**
 * The notes to store: the condensed Memory only when it keeps every pinned
 * line of the Memory the call read; otherwise it is dropped.
 */
export function guardedNotes(notes: CloseNotes, memory: string): CloseNotes {
  const { condensedMemory } = notes;
  return {
    ...notes,
    condensedMemory:
      condensedMemory !== null && keepsPinnedLines(memory, condensedMemory)
        ? condensedMemory
        : null,
  };
}
