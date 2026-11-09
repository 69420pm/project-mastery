/**
 * How much of a teaching unit its extraction covers: the share of the
 * unit's characters in chunks that some KC cites. An extraction below
 * MIN_UNIT_COVERAGE is asked once more, and the check report lists a unit
 * still below it.
 */

/** The share of a unit's characters its KCs must cite. */
export const MIN_UNIT_COVERAGE = 0.5;

/**
 * The share of the characters of `chunks` in those `citedIds` names, from
 * 0 to 1; 1 for a unit without characters.
 */
export function unitCoverage(
  chunks: ReadonlyArray<{ id: string; markdown: string }>,
  citedIds: Iterable<string>,
): number {
  const cited = new Set(citedIds);
  const total = chunks.reduce((sum, chunk) => sum + chunk.markdown.length, 0);
  if (total === 0) return 1;
  const covered = chunks.reduce(
    (sum, chunk) => sum + (cited.has(chunk.id) ? chunk.markdown.length : 0),
    0,
  );
  return covered / total;
}
