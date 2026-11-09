import type { CheckReport } from "@/features/knowledge-map/schemas";

/**
 * What the Course map tells the Student about a weak build: one line when
 * the check report has unread pages, teaching units below the coverage
 * bar or units the build gave up on, null otherwise.
 */
export function checkReportLine(report: CheckReport | null): string | null {
  if (!report) return null;
  const parts: string[] = [];
  const unread = report.unreadPages.filter((entry) => entry.pages.length > 0);
  if (unread.length > 0) {
    const pages =
      unread.length === 1
        ? pagesText(unread[0]!.pages)
        : unread
            .map((entry) => `${entry.material} ${pagesText(entry.pages)}`)
            .join(", ");
    parts.push(`couldn't read ${pages}`);
  }
  const chapters = new Set([
    ...report.unitsBelowCoverage.map((unit) => unit.chapter),
    ...report.unitsNotExtracted,
  ]).size;
  if (chapters > 0) {
    parts.push(
      `covered ${chapters} ${chapters === 1 ? "Chapter" : "Chapters"} only in part`,
    );
  }
  return parts.length === 0 ? null : `The AI ${parts.join(" and ")}`;
}

/** "p. 10", "pp. 10, 36–38": pages in order, consecutive ones as a range. */
export function pagesText(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].toSorted((a, b) => a - b);
  const ranges: string[] = [];
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end]! + 1) {
      end += 1;
    }
    ranges.push(
      end === start ? String(sorted[start]) : `${sorted[start]}–${sorted[end]}`,
    );
    start = end + 1;
  }
  return `${sorted.length === 1 ? "p." : "pp."} ${ranges.join(", ")}`;
}
