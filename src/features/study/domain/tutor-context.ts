/**
 * The tutor context (#251): the facts the AI gets on every reply, derived
 * from what the Chat's reply reads. Pure.
 */
import type { TopicScope } from "@/features/study/domain/plan";
import {
  inFinalStretch,
  type RankedItem,
} from "@/features/study/domain/ranking";
import { kcBand } from "@/features/study/domain/recall-band";
import {
  daysBetween,
  desiredRetention,
  utcDay,
  type AttemptHelp,
  type AttemptResult,
  type Goal,
  type KcRecall,
} from "@/features/study/domain/replay";
import type {
  ContextKc,
  ContextMockTask,
  MaterialNoteEntry,
  Proposal,
  ReadingSectionView,
  TutorContext,
} from "@/features/study/types";

/** The due Reviews the proposal names. */
const PROPOSED_REVIEWS = 10;
/** The ranking's first items the proposal names in the final stretch. */
const FINAL_STRETCH_ITEMS = 10;
/** The refreshes the context names as practice candidates. */
const PRACTICE_CANDIDATES = 8;
/** The longest Brief's notes the context gives, from their end. */
const MAX_BRIEF_NOTES = 4000;

const MINUTE_MS = 60_000;

/** What the tutor context is derived from. */
export type TutorContextInput = {
  now: Date;
  exam: { examDate: string | null; goal: Goal };
  /** The live KCs in map order, with what each assumes. */
  kcs: Array<{
    id: string;
    name: string;
    assumes: Array<{ name: string; description: string }>;
  }>;
  /** The ids of a Topic's anchors, from its KC ids (`topicAnchors`). */
  anchors: (kcIds: string[]) => string[];
  /** In Course order. */
  topics: Array<{
    id: string;
    name: string;
    centralQuestion: string;
    kcs: string[];
  }>;
  scope: TopicScope[];
  ranked: RankedItem[];
  recall: Map<string, KcRecall>;
  /** The Course's Attempts, oldest first. */
  attempts: Array<{
    kcId: string;
    sessionId: string;
    createdAt: string;
    result: AttemptResult;
    help: AttemptHelp;
  }>;
  session: {
    id: string;
    startedAt: string;
    /** Its Questions, oldest first. */
    questions: Array<{
      prompt: string;
      kcIds: string[];
      answered: boolean;
      gradedAt: string | null;
    }>;
    readings: ReadingSectionView[];
  };
  /** Each Topic's Reading sections, by Topic id. */
  readings: Map<string, ReadingSectionView[]>;
  /** The KCs of each unseen Problem of the Course. */
  unseenProblems: Array<{ kcs: string[] }>;
  notes: {
    /** By Topic id. */
    topics: Map<string, string>;
    memory: string;
    briefNotes: string | null;
    materialNotes: MaterialNoteEntry[];
  };
  mock: ContextMockTask[] | null;
};

/** The tutor context of a reply at `input.now`. */
export function tutorContext(input: TutorContextInput): TutorContext {
  const { now, exam, recall, topics } = input;
  const today = utcDay(now);
  const retention = desiredRetention(exam.goal);
  const kcById = new Map(input.kcs.map((kc) => [kc.id, kc]));
  const nameOf = (id: string) => kcById.get(id)?.name ?? id;
  const contextKc = (id: string): ContextKc => {
    const { band, recallToday } = kcBand(recall.get(id), retention);
    return { id, name: nameOf(id), band, recallToday };
  };
  const topicOf = new Map(
    topics.flatMap((topic) => topic.kcs.map((kc) => [kc, topic] as const)),
  );

  const todays = input.attempts.filter((a) => utcDay(a.createdAt) === today);
  const open = input.session.questions.at(-1);
  const graded = input.session.questions
    .flatMap(({ gradedAt }) => (gradedAt === null ? [] : [gradedAt]))
    .toSorted()
    .at(-1);
  const minutesSince = (at: string) =>
    Math.max(0, Math.floor((now.getTime() - Date.parse(at)) / MINUTE_MS));

  const proposal = propose(input, contextKc);
  const proposedTopic =
    !proposal.finalStretch && proposal.topic ? proposal.topic.id : null;
  const noteTopics = new Set([
    ...(proposedTopic === null ? [] : [proposedTopic]),
    ...todays.flatMap(({ kcId }) => topicOf.get(kcId)?.id ?? []),
  ]);
  const status = new Map(input.scope.map((s) => [s.id, s.status]));

  return {
    today,
    examDate: exam.examDate,
    daysLeft: exam.examDate === null ? null : daysBetween(today, exam.examDate),
    goal: exam.goal,
    session: {
      minutes: minutesSince(input.session.startedAt),
      checkedToday: todays.map(({ kcId, result, help }) => ({
        id: kcId,
        name: nameOf(kcId),
        result,
        help,
      })),
      openQuestion:
        open && open.gradedAt === null
          ? {
              prompt: open.prompt,
              kcs: open.kcIds.map((id) => ({ id, name: nameOf(id) })),
              answered: open.answered,
            }
          : null,
      minutesSinceGraded: graded === undefined ? null : minutesSince(graded),
      readings: input.session.readings,
    },
    proposal,
    practice: input.ranked
      .flatMap((item) => (item.kind === "refresh" ? [item.kcId] : []))
      .slice(0, PRACTICE_CANDIDATES)
      .map(contextKc),
    topics: topics.map((topic) => ({
      id: topic.id,
      name: topic.name,
      status: status.get(topic.id) ?? "skipped",
      learned: topic.kcs.filter((id) => recall.get(id)?.learned).length,
      total: topic.kcs.length,
    })),
    notes: {
      topics: topics.flatMap((topic) => {
        const text = input.notes.topics.get(topic.id);
        return noteTopics.has(topic.id) && text
          ? [{ topic: topic.name, text }]
          : [];
      }),
      memory: input.notes.memory,
      briefNotes:
        input.notes.briefNotes === null
          ? null
          : input.notes.briefNotes.slice(-MAX_BRIEF_NOTES),
      materialNotes: input.notes.materialNotes,
      lastSession: lastSession(input, topicOf),
    },
    mock: input.mock,
  };
}

/** The head of the ranking (`Proposal`). */
function propose(
  input: TutorContextInput,
  contextKc: (id: string) => ContextKc,
): Proposal {
  const { ranked, topics } = input;
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  if (inFinalStretch(input.exam.examDate, input.now)) {
    return {
      finalStretch: true,
      items: ranked.slice(0, FINAL_STRETCH_ITEMS).map((item) =>
        item.kind === "topic"
          ? {
              kind: "topic",
              id: item.topicId,
              name: topicById.get(item.topicId)?.name ?? item.topicId,
            }
          : { kind: item.kind, id: item.kcId, name: contextKc(item.kcId).name },
      ),
    };
  }
  const reviews = ranked.flatMap((item) =>
    item.kind === "review" ? [item.kcId] : [],
  );
  const next = ranked.find((item) => item.kind === "topic");
  const topic = next && topicById.get(next.topicId);
  const kcById = new Map(input.kcs.map((kc) => [kc.id, kc]));
  return {
    finalStretch: false,
    reviews: reviews.slice(0, PROPOSED_REVIEWS).map(contextKc),
    moreReviews: Math.max(0, reviews.length - PROPOSED_REVIEWS),
    topic: topic
      ? {
          id: topic.id,
          name: topic.name,
          centralQuestion: topic.centralQuestion,
          kcs: topic.kcs.map(contextKc),
          anchors: input.anchors(topic.kcs).map(contextKc),
          assumes: topic.kcs.flatMap((id) => {
            const kc = kcById.get(id);
            return (kc?.assumes ?? []).map((assumed) => ({
              kc: kc!.name,
              ...assumed,
            }));
          }),
          readings: input.readings.get(topic.id) ?? [],
          unseenProblems: input.unseenProblems.filter(({ kcs }) =>
            kcs.some((id) => topic.kcs.includes(id)),
          ).length,
        }
      : null,
  };
}

/**
 * The latest earlier session with Attempts: its first Attempt's day, its
 * KCs' Topics, and how many KCs it checked and had below `full`.
 */
function lastSession(
  { attempts, session }: TutorContextInput,
  topicOf: Map<string, { name: string }>,
): TutorContext["notes"]["lastSession"] {
  const last = attempts.findLast((a) => a.sessionId !== session.id);
  if (!last) return null;
  const its = attempts.filter((a) => a.sessionId === last.sessionId);
  const kcs = new Set(its.map(({ kcId }) => kcId));
  const below = new Set(
    its.filter(({ result }) => result !== "full").map(({ kcId }) => kcId),
  );
  return {
    date: utcDay(its[0]!.createdAt),
    topics: [
      ...new Set(its.flatMap(({ kcId }) => topicOf.get(kcId)?.name ?? [])),
    ],
    kcs: kcs.size,
    belowFull: below.size,
  };
}
