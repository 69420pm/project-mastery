/**
 * Course order: Materials by position, then chunks by position. The map
 * follows it in code: one Big idea per chapter title, in the order the
 * chapters first teach a KC, and each KC in the Big idea of its first
 * source.
 */

/** A chunk of the Course, in Course order, with its Part's chapter title. */
export type OrderedChunk = { id: string; chapter: string };

/** A live KC with its source chunk ids. */
export type SourcedKc = { id: string; sources: readonly string[] };

export type ArrangedMap = {
  /** Big idea names, in Course order. */
  bigIdeas: string[];
  /** Every KC with a known source, by its first source in Course order. */
  kcs: Array<{ id: string; bigIdea: string }>;
};

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

/**
 * The map in Course order. KCs whose first sources tie keep their given
 * order; a KC without a known source is left out.
 */
export function arrangeMap(
  chunks: readonly OrderedChunk[],
  kcs: readonly SourcedKc[],
): ArrangedMap {
  const place = new Map(chunks.map((chunk, index) => [chunk.id, index]));
  const firsts = kcs.flatMap((kc) => {
    const places = kc.sources.flatMap((id) => place.get(id) ?? []);
    return places.length === 0
      ? []
      : [{ id: kc.id, first: Math.min(...places) }];
  });
  const ordered = firsts.toSorted((a, b) => a.first - b.first);
  const arranged = ordered.map(({ id, first }) => ({
    id,
    bigIdea: bigIdeaName(chunks[first]!.chapter),
  }));
  return {
    bigIdeas: [...new Set(arranged.map((kc) => kc.bigIdea))],
    kcs: arranged,
  };
}
