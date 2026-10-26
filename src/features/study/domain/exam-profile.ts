/**
 * What a Mock exam is like (#185): how long a full one lasts, how long an
 * item takes by its difficulty, and the aids the Brief allows.
 */

/** How long a full Mock exam lasts. */
export const MOCK_MINUTES = 90;

/** An item's minutes by its difficulty; one point counts one minute. */
const ITEM_MINUTES = { 1: 6, 2: 12, 3: 20 } as const;

/** An item's minutes, and so its points, from its difficulty (1 to 3). */
export function itemMinutes(difficulty: number): number {
  const level = Math.min(3, Math.max(1, Math.round(difficulty))) as 1 | 2 | 3;
  return ITEM_MINUTES[level];
}

/** The Brief's answers on aids, each null until answered. */
export type ExamAids = {
  openBook: boolean | null;
  formulaSheet: boolean | null;
  calculator: boolean | null;
};

export type ExamProfile = {
  minutes: number;
  /** The aids the exam allows, as the sheet lists them. */
  aids: string[];
};

/** A full mock's minutes and the aids the Brief allows. */
export function examProfile(aids: ExamAids): ExamProfile {
  return {
    minutes: MOCK_MINUTES,
    aids: [
      aids.openBook && "Open book",
      aids.formulaSheet && "Formula sheet",
      aids.calculator && "Calculator",
    ].filter((aid): aid is string => typeof aid === "string"),
  };
}
