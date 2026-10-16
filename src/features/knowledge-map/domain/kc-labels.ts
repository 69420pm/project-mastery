import type { BloomLevel, KcType } from "@/features/knowledge-map/schemas";
import type {
  CheckReportView,
  KcView,
  MapAttempt,
} from "@/features/knowledge-map/types";

/** How the map page names a KC's facts. */

export const TYPE_NAMES: Record<KcType, string> = {
  fact: "Fact",
  concept: "Concept",
  procedure: "Procedure",
  decision: "Decision",
  prior: "Prior knowledge",
};

export const BLOOM_NAMES: Record<BloomLevel, string> = {
  remember: "Remember",
  understand: "Understand",
  apply: "Apply",
  analyze: "Analyze",
  evaluate: "Evaluate",
  create: "Create",
};

export const ORIGIN_NAMES: Record<KcView["origin"], string> = {
  content: "Taught by the materials",
  exercise: "Needed by an exercise the materials don't teach",
  prior: "Assumed by the materials",
};

export const HELP_NAMES: Record<MapAttempt["help"], string> = {
  none: "no help",
  some: "some help",
  solution_shown: "solution shown",
};

/**
 * What the check report says about a KC. The report lists KCs by name, so
 * this matches the exact name: every KC that shares it gets the flags.
 */
export function checkFlags(
  report: CheckReportView | null,
  kcName: string,
): string[] {
  if (!report) return [];
  return [
    report.ungroundedKcs.includes(kcName) && "No source",
    report.orphanKcs.includes(kcName) && "No links",
    report.untestedKcs.includes(kcName) && "No exercise tests it",
    ...report.duplicates
      .filter((pair) => pair.a === kcName || pair.b === kcName)
      .map(
        (pair) =>
          `Possible duplicate of ${pair.a === kcName ? pair.b : pair.a}`,
      ),
  ].filter((flag) => flag !== false);
}
