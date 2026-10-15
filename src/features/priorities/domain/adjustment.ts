/**
 * The model's adjustment of KC priorities (#86): entries for big ideas or
 * KCs, each a multiplier from 0 to 2 with a one-line reason, and the rule
 * for when a run asks the model again. Pure code.
 */

/** One entry of the model's answer, by big idea or KC id. */
export type AdjustmentEntry = {
  id: string;
  multiplier: number;
  reason: string;
};

/** The most a model entry multiplies a KC's base with. */
export const MAX_ADJUSTMENT = 2;

/**
 * Each KC's adjustment from the entries: a KC's own entry overrides its big
 * idea's, entries of unknown ids are dropped, and a KC without either keeps
 * multiplier 1. Multipliers are clamped to 0..MAX_ADJUSTMENT.
 */
export function adjustmentOf(
  entries: readonly AdjustmentEntry[],
  kcs: ReadonlyArray<{ id: string; bigIdea: string | null }>,
): (kcId: string) => { multiplier: number; reasons: string[] } {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const bigIdeaOf = new Map(kcs.map((kc) => [kc.id, kc.bigIdea]));
  return (kcId) => {
    const bigIdea = bigIdeaOf.get(kcId);
    const entry = byId.get(kcId) ?? (bigIdea ? byId.get(bigIdea) : undefined);
    if (!entry) return { multiplier: 1, reasons: [] };
    const multiplier = Math.min(
      MAX_ADJUSTMENT,
      Math.max(0, Number.isFinite(entry.multiplier) ? entry.multiplier : 1),
    );
    return { multiplier, reasons: entry.reason ? [entry.reason] : [] };
  };
}

/** What a run does about the adjustment. */
export type AdjustmentPlan =
  /** No notes and no answered Findings: every multiplier is 1. */
  | "skip"
  /** Nothing changed since the last adjustment: reuse the stored one. */
  | "reuse"
  /** Ask the model. */
  | "call";

/**
 * The rerun rule: the model is asked only when there are notes or answered
 * Findings and it never adjusted, or the notes, a Finding answer or the map
 * changed after `adjustedAt`.
 */
export function adjustmentPlan(input: {
  hasNotes: boolean;
  answeredAt: readonly string[];
  notesUpdatedAt: string | null;
  mapFinishedAt: string | null;
  adjustedAt: string | null;
}): AdjustmentPlan {
  if (!input.hasNotes && input.answeredAt.length === 0) return "skip";
  if (input.adjustedAt === null) return "call";
  const adjusted = Date.parse(input.adjustedAt);
  const changes = [
    input.notesUpdatedAt,
    input.mapFinishedAt,
    ...input.answeredAt,
  ].filter((at) => at !== null);
  return changes.some((at) => Date.parse(at) > adjusted) ? "call" : "reuse";
}
