/**
 * The Course language: the most common language of its Materials in
 * Course order, the earlier one on a tie; English when none has one.
 * Languages are English names, such as German, as the parse stores them.
 */
export function courseLanguage(languages: ReadonlyArray<string | null>) {
  const counts = new Map<string, number>();
  for (const language of languages) {
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  let best = "English";
  let bestCount = 0;
  for (const [language, count] of counts) {
    if (count > bestCount) [best, bestCount] = [language, count];
  }
  return best;
}
