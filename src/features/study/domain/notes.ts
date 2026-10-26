/** The Session notes the tutor reads: the Course's newest ones. */
export const SESSION_NOTES_READ = 3;

/**
 * The Topics whose Topic notes the tutor reads in a learn session: the
 * session's own Topic first, then the Topics that hold its anchors, each
 * once, in Topic order.
 */
export function topicNoteIds(
  topicId: string,
  topics: ReadonlyArray<{ id: string; kcs: readonly string[] }>,
  anchorIds: readonly string[],
): string[] {
  const anchors = new Set(anchorIds);
  return [
    topicId,
    ...topics
      .filter(
        (topic) =>
          topic.id !== topicId && topic.kcs.some((kc) => anchors.has(kc)),
      )
      .map(({ id }) => id),
  ];
}
