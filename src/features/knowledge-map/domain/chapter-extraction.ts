/**
 * The extraction of one teaching unit (task `map`): the KCs it teaches and
 * the Prerequisites among them, checked in code against the ids the call
 * was offered.
 */

/** Something a KC uses that its unit does not explain. */
export type Assumption = { name: string; description: string };

/**
 * A KC of an extraction: with the call's chunk ids in its answer, with
 * stored chunk ids once checked.
 */
export type ExtractedKc = {
  name: string;
  description: string;
  chunkIds: string[];
  assumes: Assumption[];
};

/** What the extraction call answers; Prerequisites name KCs. */
export type AnsweredExtraction = {
  kcs: ExtractedKc[];
  prerequisites: Array<{ from: string; to: string }>;
};

/** A checked extraction: Prerequisites by index into `kcs`. */
export type UnitExtraction = {
  kcs: ExtractedKc[];
  prerequisites: Array<{ from: number; to: number }>;
};

const MAX_NAME = 200;
const MAX_DESCRIPTION = 1000;
const MAX_ASSUMES = 3;

const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * Checks an answer against the unit's chunks, `chunkIdOf` mapping the
 * call's ids to stored ones: a KC keeps its known chunk ids and is dropped
 * without one; a Prerequisite is dropped when an end names no kept KC, or
 * both name the same.
 */
export function checkExtraction(
  answer: AnsweredExtraction,
  chunkIdOf: ReadonlyMap<string, string>,
): UnitExtraction {
  const kcs: ExtractedKc[] = [];
  for (const kc of answer.kcs) {
    const chunkIds = [
      ...new Set(kc.chunkIds.flatMap((id) => chunkIdOf.get(id) ?? [])),
    ];
    const name = kc.name.trim().slice(0, MAX_NAME);
    const description = kc.description.trim().slice(0, MAX_DESCRIPTION);
    if (chunkIds.length === 0 || !name || !description) continue;
    kcs.push({
      name,
      description,
      chunkIds,
      assumes: kc.assumes
        .flatMap((assumed) => {
          const name = assumed.name.trim().slice(0, MAX_NAME);
          const description = assumed.description
            .trim()
            .slice(0, MAX_DESCRIPTION);
          return name && description ? [{ name, description }] : [];
        })
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
