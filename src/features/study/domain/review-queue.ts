/**
 * A review session's queue (#184): the KCs due at the session's start,
 * grouped and interleaved, with each group's status from the session's
 * questions and attempts. Pure code, rebuilt on every reply; nothing is
 * stored.
 */
import {
  isDue,
  retrievability,
  utcDay,
  type AttemptResult,
  type KcSchedule,
} from "@/features/study/domain/replay";

/** How long a review session's queue lasts, in minutes. */
const REVIEW_MINUTES = 20;

/** The most KCs one question of a review session tests. */
const MAX_GROUP_KCS = 3;

/**
 * A group's status: `open` until every KC has a first attempt in the
 * session, then `done`, or `retry` while a KC's first attempt was below full
 * and no later question in the session has tested it.
 */
export type ReviewGroupStatus = "open" | "done" | "retry";

/** A KC of the queue as the AI is told of it. */
type ReviewKc = {
  id: string;
  name: string;
  type: string;
  /** Its first Topic; null without one. */
  topicId: string | null;
};

/** A group of the queue: the KCs one question tests. */
export type ReviewGroup = {
  /** Its seed's Topic; null without one. */
  topicId: string | null;
  /** In rank order, the seed first. */
  kcs: ReviewKc[];
  status: ReviewGroupStatus;
  /** The KCs to ask again; empty unless the status is `retry`. */
  retryKcIds: string[];
};

/** A question asked in the session. */
type SessionQuestion = { kcIds: string[]; askedAt: string };

/** An attempt stored in the session. */
type SessionAttempt = {
  kcId: string;
  result: AttemptResult;
  createdAt: string;
};

/**
 * The review queue of a session started at `startedAt`. `schedules` are
 * replayed without the session's attempts, so a KC answered here stays in
 * it. The KCs due then (in map order in `kcs`) are ranked by Priority × (1 −
 * recall at the start), ties in map order, and cut to 20 minutes at
 * `minutesPerReview`, keeping at least one. Groups are built greedily in
 * rank order: the top ungrouped KC seeds one, and up to 2 more join in rank
 * order when they share its Topic (`topicOf`) or link (`links`, either way)
 * to a KC already in it. Groups go by their seed's rank, but never after a
 * group of the same Topic while one of another is left.
 */
export function planReviewQueue({
  kcs,
  schedules,
  priorities,
  startedAt,
  minutesPerReview,
  topicOf,
  links,
  questions,
  attempts,
}: {
  kcs: Array<{ id: string; name: string; type: string }>;
  schedules: ReadonlyMap<string, KcSchedule>;
  priorities: Record<string, number>;
  startedAt: Date;
  minutesPerReview: number;
  topicOf: ReadonlyMap<string, string>;
  /** Prerequisite and semantic links between KCs. */
  links: ReadonlyArray<{ from: string; to: string }>;
  questions: SessionQuestion[];
  attempts: SessionAttempt[];
}): ReviewGroup[] {
  const day = utcDay(startedAt);
  const ranked = kcs
    .flatMap((kc, position) => {
      const card = schedules.get(kc.id)?.card;
      if (!card || !isDue(card, day)) return [];
      const urgency =
        (priorities[kc.id] ?? 0) * (1 - retrievability(card, startedAt));
      return [{ kc, position, urgency }];
    })
    .toSorted((a, b) => b.urgency - a.urgency || a.position - b.position)
    .map(({ kc: { id, name, type } }) => ({
      id,
      name,
      type,
      topicId: topicOf.get(id) ?? null,
    }));
  const fits =
    minutesPerReview > 0
      ? Math.floor(REVIEW_MINUTES / minutesPerReview)
      : ranked.length;
  const queue = ranked.slice(0, Math.max(1, fits));

  const linked = (a: string, b: string) =>
    links.some(
      ({ from, to }) => (from === a && to === b) || (from === b && to === a),
    );
  const groups: ReviewKc[][] = [];
  const grouped = new Set<string>();
  for (const seed of queue) {
    if (grouped.has(seed.id)) continue;
    const group = [seed];
    grouped.add(seed.id);
    for (const kc of queue) {
      if (group.length === MAX_GROUP_KCS) break;
      if (grouped.has(kc.id)) continue;
      const joins =
        (seed.topicId !== null && kc.topicId === seed.topicId) ||
        group.some((member) => linked(member.id, kc.id));
      if (!joins) continue;
      group.push(kc);
      grouped.add(kc.id);
    }
    groups.push(group);
  }

  const ordered: ReviewKc[][] = [];
  const left = [...groups];
  while (left.length > 0) {
    const previous = ordered.at(-1)?.[0]?.topicId ?? null;
    const index = left.findIndex(
      ([seed]) => previous === null || seed!.topicId !== previous,
    );
    ordered.push(...left.splice(Math.max(0, index), 1));
  }

  return ordered.map((group) => ({
    topicId: group[0]!.topicId,
    kcs: group,
    ...groupStatus(group, questions, attempts),
  }));
}

/** A group's status from the session's questions and attempts. */
function groupStatus(
  group: ReviewKc[],
  questions: SessionQuestion[],
  attempts: SessionAttempt[],
): { status: ReviewGroupStatus; retryKcIds: string[] } {
  const byTime = attempts.toSorted(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  const firsts = group.map(({ id }) => byTime.find((a) => a.kcId === id));
  if (firsts.some((first) => first === undefined)) {
    return { status: "open", retryKcIds: [] };
  }
  const retryKcIds = firsts.flatMap((first) =>
    first!.result !== "full" &&
    !questions.some(
      (question) =>
        question.kcIds.includes(first!.kcId) &&
        Date.parse(question.askedAt) > Date.parse(first!.createdAt),
    )
      ? [first!.kcId]
      : [],
  );
  return {
    status: retryKcIds.length > 0 ? "retry" : "done",
    retryKcIds,
  };
}
