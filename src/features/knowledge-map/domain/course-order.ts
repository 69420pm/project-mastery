/**
 * Course order: Materials by position, then chunks by position. The map
 * follows it in code (`map-plan.ts`): one Big idea per chapter title, in
 * the order the chapters first teach a KC.
 */

const MAX_BIG_IDEA_NAME = 200;

/**
 * The Course language: the most common language of its Materials in
 * Course order, the earlier one on a tie; English when none has one.
 */
export function courseLanguage(languages: ReadonlyArray<string | null>) {
  const counts = new Map<string, number>();
  for (const language of languages) {
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  let best = "en";
  let bestCount = 0;
  for (const [language, count] of counts) {
    if (count > bestCount) [best, bestCount] = [language, count];
  }
  return best;
}

/** The Big idea a chapter title names. */
export function bigIdeaName(chapter: string): string {
  return chapter.trim().slice(0, MAX_BIG_IDEA_NAME);
}
