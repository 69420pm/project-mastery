/** The longest label shown for an untitled Chat, before the ellipsis. */
const MAX_LABEL_LENGTH = 40;

/**
 * How a Chat is named in the Chat list: its title, or until it has one, its
 * first message on one line, shortened at a word.
 */
export function chatLabel({
  title,
  firstMessage,
}: {
  title: string | null;
  firstMessage: string | null;
}): string {
  if (title?.trim()) return title.trim();

  const text = (firstMessage ?? "").replace(/\s+/g, " ").trim();
  if (text === "") return "New chat";
  if (text.length <= MAX_LABEL_LENGTH) return text;

  const head = text.slice(0, MAX_LABEL_LENGTH + 1);
  const wordEnd = head.lastIndexOf(" ");
  return `${head.slice(0, wordEnd > 0 ? wordEnd : MAX_LABEL_LENGTH)}…`;
}
