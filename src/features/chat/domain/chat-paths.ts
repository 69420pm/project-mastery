/** The page of a new Chat in a Course. */
export function newChatPath(courseId: string): string {
  return `/courses/${courseId}/chat`;
}

/** The page of a stored Chat in its Course. */
export function chatPath(courseId: string, chatId: string): string {
  return `${newChatPath(courseId)}/${chatId}`;
}
