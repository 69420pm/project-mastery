/**
 * The page numbers, 1-based and in order, of a Material with `pageCount`
 * pages that have no stored page result yet: the pages a retried parse still
 * renders and reads.
 */
export function missingPages(
  pageCount: number,
  storedPageNumbers: readonly number[],
): number[] {
  const stored = new Set(storedPageNumbers);
  const missing: number[] = [];
  for (let page = 1; page <= pageCount; page++) {
    if (!stored.has(page)) missing.push(page);
  }
  return missing;
}
