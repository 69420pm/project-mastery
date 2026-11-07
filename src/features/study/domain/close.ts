/**
 * The close of an ended Study session (#187, #251): what its `close` call
 * reads.
 */

/** A Memory longer than this is condensed by the close call. */
export const CONDENSE_MEMORY_FROM = 3_000;

/** The most characters of a Topic note. */
export const MAX_TOPIC_NOTE_LENGTH = 1_500;

/** A Topic the session's Attempts touched, with its note so far. */
export type TouchedTopic = {
  id: string;
  name: string;
  /** Its Topic note; null before the first. */
  note: string | null;
};

/** What a session's close is built from, as stored. */
export type CloseSource = {
  /** The Chat's messages, oldest first, with their stored parts. */
  messages: Array<{ role: string; parts: unknown }>;
  questions: Array<{
    prompt: string;
    answer: string | null;
    attempts: Array<{ kcName: string; result: string; help: string }>;
  }>;
  /** The Topics of the KCs of the session's Attempts. */
  topics: TouchedTopic[];
  memory: string;
};

/** What the close call reads. */
export type CloseInput = {
  /** The messages' text, tool calls and other parts left out. */
  transcript: Array<{ role: "student" | "tutor"; text: string }>;
  questions: CloseSource["questions"];
  /** The Topics to write a note for; none without Attempts. */
  topics: TouchedTopic[];
  memory: string;
  /** Whether the call condenses the Memory, once it is long. */
  condensesMemory: boolean;
};

/** The close call's notes, trimmed to what the session gets. */
export type CloseNotes = {
  /** One note per touched Topic at most, each replacing the old one. */
  topicNotes: Array<{ topicId: string; text: string }>;
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
  return {
    transcript,
    questions: source.questions,
    topics: source.topics,
    memory: source.memory,
    condensesMemory: source.memory.length > CONDENSE_MEMORY_FROM,
  };
}

/**
 * The Topic notes to store: one per Topic of the input, the first for a
 * Topic given twice; a note for any other Topic is dropped.
 */
export function touchedTopicNotes(
  input: CloseInput,
  notes: Array<{ topicId: string; text: string }>,
): CloseNotes["topicNotes"] {
  const touched = new Set(input.topics.map(({ id }) => id));
  const kept = new Map<string, string>();
  for (const { topicId, text } of notes) {
    if (touched.has(topicId) && !kept.has(topicId)) kept.set(topicId, text);
  }
  return [...kept].map(([topicId, text]) => ({ topicId, text }));
}
