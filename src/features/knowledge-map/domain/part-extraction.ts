import type { KcType } from "@/features/knowledge-map/schemas";

/**
 * The extraction of one teaching Part (task `map`): the KCs it teaches and
 * the Prerequisites among them, checked in code against the ids the call
 * was offered.
 */

/** Words of a Part per KC it is asked for. */
const WORDS_PER_KC = 150;
const MAX_KCS = 12;

/** How many KCs a Part is asked for: one per 150 words, from 1 to 12. */
export function kcBudget(markdowns: readonly string[]): number {
  const words = markdowns.join(" ").split(/\s+/).filter(Boolean).length;
  return Math.min(MAX_KCS, Math.max(1, Math.round(words / WORDS_PER_KC)));
}

/**
 * A KC of an extraction: with the call's chunk ids in its answer, with
 * stored chunk ids once checked.
 */
export type ExtractedKc = {
  name: string;
  description: string;
  type: KcType;
  chunkIds: string[];
  assumes: string[];
};

/** What the extraction call answers; Prerequisites name KCs. */
export type AnsweredExtraction = {
  kcs: ExtractedKc[];
  prerequisites: Array<{ from: string; to: string }>;
};

/** A checked extraction: Prerequisites by index into `kcs`. */
export type PartExtraction = {
  kcs: ExtractedKc[];
  prerequisites: Array<{ from: number; to: number }>;
};

const MAX_NAME = 200;
const MAX_DESCRIPTION = 1000;
const MAX_ASSUMES = 3;

const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * Checks an answer against the Part's chunks, `chunkIdOf` mapping the
 * call's ids to stored ones: a KC keeps its known chunk ids and is dropped
 * without one; the first `budget` valid KCs are kept; a Prerequisite is
 * dropped when an end names no kept KC, or both name the same.
 */
export function checkExtraction(
  answer: AnsweredExtraction,
  chunkIdOf: ReadonlyMap<string, string>,
  budget: number,
): PartExtraction {
  const kcs: ExtractedKc[] = [];
  for (const kc of answer.kcs) {
    if (kcs.length >= budget) break;
    const chunkIds = [
      ...new Set(kc.chunkIds.flatMap((id) => chunkIdOf.get(id) ?? [])),
    ];
    const name = kc.name.trim().slice(0, MAX_NAME);
    const description = kc.description.trim().slice(0, MAX_DESCRIPTION);
    if (chunkIds.length === 0 || !name || !description) continue;
    kcs.push({
      name,
      description,
      type: kc.type,
      chunkIds,
      assumes: kc.assumes
        .map((assumed) => assumed.trim())
        .filter(Boolean)
        .slice(0, MAX_ASSUMES),
    });
  }

  const indexOf = new Map<string, number>();
  kcs.forEach((kc, index) => {
    if (!indexOf.has(nameKey(kc.name))) indexOf.set(nameKey(kc.name), index);
  });
  const prerequisites = answer.prerequisites.flatMap(({ from, to }) => {
    const link = {
      from: indexOf.get(nameKey(from)),
      to: indexOf.get(nameKey(to)),
    };
    return link.from === undefined ||
      link.to === undefined ||
      link.from === link.to
      ? []
      : [link as { from: number; to: number }];
  });
  return { kcs, prerequisites };
}
