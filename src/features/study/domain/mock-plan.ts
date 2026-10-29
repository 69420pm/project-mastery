import {
  itemMinutes,
  MOCK_MINUTES,
} from "@/features/study/domain/exam-profile";

/**
 * How a Mock exam is assembled (#185): the blueprint of slots per Topic and
 * difficulty, the fill of each slot from the Course's unseen Problems, the
 * Problems generated for the empty ones, and the final mock, which is the
 * reserved exam itself.
 */

export type Difficulty = 1 | 2 | 3;

const DIFFICULTIES: Difficulty[] = [1, 2, 3];

/** The share of a mock's points at each difficulty. */
export const DIFFICULTY_SPLIT: Record<Difficulty, number> = {
  1: 0.3,
  2: 0.5,
  3: 0.2,
};

/** The most empty slots of one mock that get a generated Problem. */
export const MAX_GAPS = 6;

/** A place in the blueprint for one item. */
export type MockSlot = { topicId: string; difficulty: Difficulty };

/**
 * The blueprint: the in-plan Topics share the minutes in proportion to their
 * priority (equally when none has any), split 30/50/20 by points across
 * difficulties 1 to 3. Each step adds a slot for the Topic and difficulty
 * furthest below its share, until that slot would go past the minutes.
 * Slots come in Topic order, then by difficulty.
 */
export function planMock(
  topics: Array<{ id: string; priority: number }>,
  minutes: number = MOCK_MINUTES,
): MockSlot[] {
  const total = topics.reduce((sum, t) => sum + Math.max(0, t.priority), 0);
  const share = (priority: number) =>
    total > 0 ? Math.max(0, priority) / total : 1 / topics.length;
  const cells = topics.flatMap((topic, index) =>
    DIFFICULTIES.map((difficulty) => ({
      index,
      slot: { topicId: topic.id, difficulty },
      target: minutes * share(topic.priority) * DIFFICULTY_SPLIT[difficulty],
      have: 0,
    })),
  );
  const chosen: Array<(typeof cells)[number]> = [];
  let used = 0;
  for (;;) {
    let next: (typeof cells)[number] | undefined;
    for (const cell of cells) {
      if (!next || cell.target - cell.have > next.target - next.have) {
        next = cell;
      }
    }
    if (!next) break;
    const cost = itemMinutes(next.slot.difficulty);
    if (used + cost > minutes) break;
    next.have += cost;
    used += cost;
    chosen.push({ ...next });
  }
  return chosen
    .toSorted(
      (a, b) => a.index - b.index || a.slot.difficulty - b.slot.difficulty,
    )
    .map(({ slot }) => slot);
}

/** Where a candidate comes from, in the order a slot takes them. */
export const FILL_ORDER = ["old_exam", "exercise", "variant", "new"] as const;

export type FillSource = (typeof FILL_ORDER)[number];

/** An Exercise or a ready generated Problem a slot may take. */
export type MockCandidate = {
  id: string;
  kind: "exercise" | "problem";
  source: FillSource;
  kcs: string[];
  difficulty: number;
  /** Asked as a question already. */
  seen: boolean;
  /** A Problem the Student flagged. */
  flagged?: boolean;
  /** An Exercise of the active reserved exam. */
  reserved?: boolean;
};

/**
 * Each slot's item, or null for an empty slot: the first candidate in fill
 * order (unseen old-exam Exercises, unseen Exercises, unseen ready variants,
 * unseen ready new Problems) that tests a KC of the slot's Topic, at the
 * nearest difficulty within that source, earlier candidates first on a tie.
 * Flagged, reserved and seen candidates never fill a slot, and no
 * candidate fills two.
 */
export function fillMock<Candidate extends MockCandidate>(
  slots: MockSlot[],
  topicKcs: Map<string, string[]>,
  candidates: Candidate[],
): Array<Candidate | null> {
  const used = new Set<string>();
  const usable = candidates.filter((c) => !c.seen && !c.flagged && !c.reserved);
  return slots.map((slot) => {
    const kcs = topicKcs.get(slot.topicId) ?? [];
    const matching = usable.filter(
      (c) => !used.has(c.id) && c.kcs.some((kc) => kcs.includes(kc)),
    );
    for (const source of FILL_ORDER) {
      let best: Candidate | null = null;
      for (const candidate of matching) {
        if (candidate.source !== source) continue;
        const distance = Math.abs(candidate.difficulty - slot.difficulty);
        if (!best || distance < Math.abs(best.difficulty - slot.difficulty)) {
          best = candidate;
        }
      }
      if (best) {
        used.add(best.id);
        return best;
      }
    }
    return null;
  });
}

/** A Problem to generate for an empty slot. */
export type GapProblem =
  | {
      source: "variant";
      exerciseId: string;
      kcs: string[];
      difficulty: number;
    }
  | { source: "new"; kcs: [string]; difficulty: Difficulty };

/**
 * The Problems for up to 6 empty slots, by slot index: a variant of a seen
 * Exercise of the slot's Topic at the nearest difficulty, one not yet
 * varied for this mock, or else a new Problem at the slot's difficulty for
 * the Topic's KC of highest Priority (teaching order on a tie). A Topic
 * without KCs gets none.
 */
export function planGaps(
  slots: Array<MockSlot | null>,
  topicKcs: Map<string, string[]>,
  exercises: Array<Pick<MockCandidate, "id" | "kcs" | "difficulty" | "seen">>,
  priorities: Record<string, number>,
): Array<{ slot: number; problem: GapProblem }> {
  const varied = new Set<string>();
  const gaps: Array<{ slot: number; problem: GapProblem }> = [];
  slots.forEach((slot, index) => {
    if (!slot || gaps.length >= MAX_GAPS) return;
    const kcs = topicKcs.get(slot.topicId) ?? [];
    let best: (typeof exercises)[number] | null = null;
    for (const exercise of exercises) {
      if (!exercise.seen || varied.has(exercise.id)) {
        continue;
      }
      if (!exercise.kcs.some((kc) => kcs.includes(kc))) continue;
      const distance = Math.abs(exercise.difficulty - slot.difficulty);
      if (!best || distance < Math.abs(best.difficulty - slot.difficulty)) {
        best = exercise;
      }
    }
    if (best) {
      varied.add(best.id);
      gaps.push({
        slot: index,
        problem: {
          source: "variant",
          exerciseId: best.id,
          kcs: best.kcs,
          difficulty: best.difficulty,
        },
      });
      return;
    }
    const top = kcs.reduce<string | null>(
      (found, kc) =>
        found === null || (priorities[kc] ?? 0) > (priorities[found] ?? 0)
          ? kc
          : found,
      null,
    );
    if (top !== null) {
      gaps.push({
        slot: index,
        problem: { source: "new", kcs: [top], difficulty: slot.difficulty },
      });
    }
  });
  return gaps;
}

/**
 * An item's predicted success: the mean recall today of its KCs, a KC
 * without a card counting as 0; 0 without KCs.
 */
export function predictedSuccess(
  kcs: string[],
  recall: Map<string, number | null>,
): number {
  if (kcs.length === 0) return 0;
  return kcs.reduce((sum, kc) => sum + (recall.get(kc) ?? 0), 0) / kcs.length;
}

/** A mock's duration and predicted score from its items. */
export function mockTotals(
  items: Array<{ points: number; predictedSuccess: number }>,
): { durationMinutes: number; predictedScore: number } {
  return {
    durationMinutes: items.reduce((sum, item) => sum + item.points, 0),
    predictedScore: items.reduce(
      (sum, item) => sum + item.points * item.predictedSuccess,
      0,
    ),
  };
}
