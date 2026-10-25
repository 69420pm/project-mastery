import {
  withLinks,
  type Prerequisite,
} from "@/features/knowledge-map/domain/links";
import type {
  KnowledgeMap,
  SemanticLinkType,
} from "@/features/knowledge-map/schemas";

/**
 * The corrections step of an Update map (#181): the map Findings the
 * Student accepted, and the changes the `correctMap` call proposes for
 * them, applied to the map. Each Finding may only change the links between
 * its own two KCs and the description of its KC; code drops the rest.
 */

/**
 * An accepted map Finding: for a link kind, `linkedKcId` is the
 * prerequisite (or the semantic neighbour) of `kcId`; null for
 * `wrong_description`.
 */
export type MapCorrection = {
  id: string;
  kind: "missing_link" | "wrong_link" | "wrong_description";
  kcId: string;
  linkedKcId: string | null;
  quote: string;
  reason: string;
  /** The quoted chunk's Markdown. */
  chunk: string;
};

type Pair = { from: string; to: string };

/** What the call proposes for one Finding, by the map's KC ids. */
export type CorrectionAnswer = {
  outcome: string;
  addPrerequisites: Pair[];
  removePrerequisites: Pair[];
  addSemanticLinks: Array<Pair & { coreType: SemanticLinkType; label: string }>;
  removeSemanticLinks: Pair[];
  descriptions: Array<{ kcId: string; description: string }>;
};

/** The outcome of a Finding the call gave no answer for. */
export const NO_CHANGE_OUTCOME = "No change.";

/** The most characters of a stored outcome. */
const MAX_OUTCOME_LENGTH = 300;

/** The accepted Findings whose KCs are all on the map, which the call sees. */
export function correctionsOnMap(
  map: Pick<KnowledgeMap, "kcs">,
  corrections: MapCorrection[],
): MapCorrection[] {
  const ids = new Set(map.kcs.map((kc) => kc.id));
  return corrections.filter(
    (finding) =>
      ids.has(finding.kcId) &&
      (finding.linkedKcId === null || ids.has(finding.linkedKcId)),
  );
}

/**
 * The map with each Finding's answer applied, the prerequisite edges
 * dropped to break cycles, and every Finding's one-line outcome by id,
 * also for a Finding left unchanged or unanswered. A link change between
 * other KCs than the Finding's two, or a description of any KC but its
 * own, is dropped. Applying the same answers twice changes nothing more.
 */
export function withCorrections(
  map: KnowledgeMap,
  corrections: MapCorrection[],
  answers: ReadonlyMap<string, CorrectionAnswer>,
): {
  map: KnowledgeMap;
  droppedCycleEdges: Prerequisite[];
  outcomes: Array<{ id: string; outcome: string }>;
} {
  let prerequisites = map.prerequisites;
  let semanticLinks = map.semanticLinks;
  const descriptions = new Map<string, string>();
  for (const finding of corrections) {
    const answer = answers.get(finding.id);
    if (!answer) continue;
    const own = (link: Pair) =>
      finding.linkedKcId !== null &&
      [finding.kcId, finding.linkedKcId].includes(link.from) &&
      [finding.kcId, finding.linkedKcId].includes(link.to) &&
      link.from !== link.to;
    const removed = (removals: Pair[]) => (link: Pair) =>
      !removals.some(
        (pair) => own(pair) && pair.from === link.from && pair.to === link.to,
      );
    prerequisites = [
      ...prerequisites.filter(removed(answer.removePrerequisites)),
      ...answer.addPrerequisites
        .filter(own)
        .map((pair) => ({ ...pair, extractionConfidence: 1 })),
    ];
    semanticLinks = [
      ...semanticLinks.filter(removed(answer.removeSemanticLinks)),
      ...answer.addSemanticLinks.filter(own),
    ];
    for (const change of answer.descriptions) {
      if (change.kcId === finding.kcId) {
        descriptions.set(change.kcId, change.description);
      }
    }
  }
  const linked = withLinks(
    {
      ...map,
      kcs: map.kcs.map((kc) => ({
        ...kc,
        description: descriptions.get(kc.id) ?? kc.description,
      })),
    },
    { prerequisites, semanticLinks, priorKcs: [] },
  );
  return {
    ...linked,
    outcomes: corrections.map((finding) => ({
      id: finding.id,
      outcome: oneLine(answers.get(finding.id)?.outcome ?? NO_CHANGE_OUTCOME),
    })),
  };
}

/** One line of at most `MAX_OUTCOME_LENGTH` characters. */
function oneLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim() || NO_CHANGE_OUTCOME;
  return line.length <= MAX_OUTCOME_LENGTH
    ? line
    : `${line.slice(0, MAX_OUTCOME_LENGTH - 1)}…`;
}
