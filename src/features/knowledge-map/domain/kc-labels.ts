import type { KcType } from "@/features/knowledge-map/schemas";
import type {
  CheckReportView,
  KcView,
  MapAttempt,
  MapKcLearning,
} from "@/features/knowledge-map/types";

/** How the map page names a KC's facts. */

export const TYPE_NAMES: Record<KcType, string> = {
  fact: "Fact",
  concept: "Concept",
  procedure: "Procedure",
  decision: "Decision",
};

export const ORIGIN_NAMES: Record<KcView["origin"], string> = {
  content: "Taught by the materials",
  exercise: "Needed by an exercise the materials don't teach",
};

export const RESULT_NAMES: Record<MapAttempt["result"], string> = {
  full: "Full",
  partial: "Partial",
  wrong: "Wrong",
};

export const HELP_NAMES: Record<MapAttempt["help"], string> = {
  none: "no help",
  some: "some help",
  solution_shown: "solution shown",
};

export const STATE_NAMES: Record<MapKcLearning[string]["state"], string> = {
  new: "New",
  learning: "Learning",
  due: "Due",
  known: "Known",
};

export const DIFFICULTY_NAMES: Record<1 | 2 | 3, string> = {
  1: "Easy",
  2: "Medium",
  3: "Hard",
};

export type CheckBadgeKind = "ungrounded" | "orphan" | "untested" | "duplicate";

/**
 * What the check report says about a KC. The report lists KCs by name, so
 * this matches the exact name: every KC that shares it gets the badges.
 */
export function checkBadges(
  report: CheckReportView | null,
  kcName: string,
): Array<{ kind: CheckBadgeKind; label: string }> {
  if (!report) return [];
  const badges: Array<{ kind: CheckBadgeKind; label: string } | false> = [
    report.ungroundedKcs.includes(kcName) && {
      kind: "ungrounded",
      label: "No source",
    },
    report.orphanKcs.includes(kcName) && { kind: "orphan", label: "No links" },
    report.untestedKcs.includes(kcName) && {
      kind: "untested",
      label: "No exercise tests it",
    },
    ...report.duplicates
      .filter((pair) => pair.a === kcName || pair.b === kcName)
      .map((pair) => ({
        kind: "duplicate" as const,
        label: `Possible duplicate of ${pair.a === kcName ? pair.b : pair.a}`,
      })),
  ];
  return badges.filter((badge) => badge !== false);
}

/** The labels of a KC's check badges. */
export function checkFlags(
  report: CheckReportView | null,
  kcName: string,
): string[] {
  return checkBadges(report, kcName).map((badge) => badge.label);
}
