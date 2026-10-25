import { readFile } from "node:fs/promises";
import { isStepCount, streamText, type ModelMessage } from "ai";
import { z } from "zod";
import { chatReplySettings } from "@/features/chat/server";
import {
  endsReply,
  mathRunner,
  planReviewQueue,
  replayKc,
  TutorToolError,
  tutorTools,
  type ReplayAttempt,
  type ReviewGroup,
  type TutorContext,
  type TutorToolActions,
} from "@/features/study/server";
import { costUsd, tokenUsage } from "@/lib/ai/cost";
import { aiTask } from "@/lib/ai/models";
import type { EvalDefinition } from "./eval";
import { pace } from "./learn";

/**
 * A whole review session (#184): the real Chat instructions, model settings
 * and tools review 6 due KCs of the jet-engines gold course in 3 Topics,
 * with in-memory actions as in `learn`. The review queue is rebuilt by
 * `planReviewQueue` on every reply from the session's questions and
 * attempts, as in the app. A scripted Student answers each `ask` with the
 * answer whose KCs best match the question's, each labelled per KC, and
 * otherwise says to go on. One Student is mostly right, the other has
 * planted errors.
 *
 * Code checks each session; the gate is that both pass, in a run of at most
 * 60 model calls.
 */

const LABELS = ["full", "below_full"] as const;
type Label = (typeof LABELS)[number];

const answerSchema = z.object({
  text: z.string().min(1),
  /** By gold KC id: the KCs the answer is for, each labelled. */
  labels: z.record(z.string(), z.enum(LABELS)),
});

type ScriptedAnswer = z.infer<typeof answerSchema>;

const input = z.object({
  /**
   * The Student's answers. A question takes the first unused answer that
   * shares the most KCs with it, then the best used one: so a retry
   * lists its answer after the first one on its KC.
   */
  answers: z.array(answerSchema).min(1),
});

type Input = z.infer<typeof input>;

const expectedOutput = z.null();

/** The most model calls of one session, half the run's 60. */
const SESSION_CALLS = 30;
/** As in the Chat handler. */
const MAX_STEPS = 5;
const MAX_REPLIES = 14;

const GREETING = "Let's start studying.";
const GO_ON = "OK, let's go on.";
const UNSCRIPTED = "I'm not sure how to answer this one.";

// --- The gold course's due KCs --------------------------------------------

const GOLD = "evals/gold/jet-engines/gold.json";
const CHUNKS = "evals/gold/jet-engines/chunks.json";

/** The due KCs, in 3 Topics: 4 of the first, one each of two more. */
const DUE = ["KC01", "KC02", "KC03", "KC04", "KC09", "KC15"];
const TOPICS = ["BI1", "BI2", "BI3"];

const TODAY = "2026-11-02";
const EXAM_DATE = "2026-12-03";
/** When the review session starts. */
const START = Date.parse(`${TODAY}T09:00:00.000Z`);
/** When an earlier, ended session taught every due KC, graded full. */
const TAUGHT_AT = "2026-10-20T09:00:00.000Z";
const TAUGHT_SESSION = "taught";
const REVIEW_SESSION = "review";
/** `good_grade`'s desired retention. */
const RETENTION = 0.9;
const MINUTES_PER_REVIEW = 2;

const goldSchema = z.object({
  bigIdeas: z.array(z.object({ id: z.string(), name: z.string() })),
  kcs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      type: z.string(),
      bigIdea: z.string().nullable(),
      sources: z.array(z.number()),
    }),
  ),
  prerequisites: z.array(z.object({ from: z.string(), to: z.string() })),
});

const chunksSchema = z.array(
  z.object({
    position: z.number(),
    page_from: z.number(),
    markdown: z.string(),
  }),
);

type Gold = z.infer<typeof goldSchema>;
type Chunk = z.infer<typeof chunksSchema>[number];

/** A stable uuid per number, so the ids look like the app's. */
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const COURSE_ID = uuid(1);
const MATERIAL_ID = uuid(5);
const MATERIAL = "Jet engines, Chapter 7";

let courseCache: Promise<{ gold: Gold; chunks: Chunk[] }> | undefined;
function loadCourse() {
  courseCache ??= Promise.all([
    readFile(GOLD, "utf8"),
    readFile(CHUNKS, "utf8"),
  ]).then(([gold, chunks]) => ({
    gold: goldSchema.parse(JSON.parse(gold)),
    chunks: chunksSchema.parse(JSON.parse(chunks)),
  }));
  return courseCache;
}

/** The course's ids: gold ids map to uuids and back. */
function courseOf({ gold, chunks }: { gold: Gold; chunks: Chunk[] }) {
  const toId = new Map([
    ...gold.kcs.map((kc, i) => [kc.id, uuid(0x100 + i)] as const),
    ...gold.bigIdeas.map((b, i) => [b.id, uuid(0x10 + i)] as const),
  ]);
  const toGold = new Map([...toId].map(([goldId, id]) => [id, goldId]));
  const id = (goldId: string) => toId.get(goldId)!;
  const goldId = (uuidId: string) => toGold.get(uuidId);
  const topics = gold.bigIdeas
    .filter((b) => TOPICS.includes(b.id))
    .map((b) => ({
      id: id(b.id),
      goldId: b.id,
      name: b.name,
      kcs: gold.kcs.filter((kc) => kc.bigIdea === b.id),
    }));
  const topicOf = new Map(
    topics.flatMap((t) => t.kcs.map((kc) => [id(kc.id), t.id] as const)),
  );
  const chunk = (position: number) =>
    chunks.find((c) => c.position === position)!;
  // Every due KC was taught by one full answer in an ended session.
  const prior = (kcId: string): ReplayAttempt => ({
    kcId,
    sessionId: TAUGHT_SESSION,
    createdAt: TAUGHT_AT,
    kind: "learn",
    result: "full",
    help: "none",
    questionId: `taught-${kcId}`,
    confidence: null,
    seconds: null,
  });
  return {
    gold,
    id,
    goldId,
    topics,
    topicOf,
    chunk,
    prior,
    links: gold.prerequisites.map((p) => ({ from: id(p.from), to: id(p.to) })),
  };
}

type Course = ReturnType<typeof courseOf>;

/** Replays a KC's attempts, every session ended. */
const replay = (attempts: ReplayAttempt[]) =>
  replayKc(attempts, {
    ended: () => true,
    examDate: EXAM_DATE,
    retention: RETENTION,
  });

type SessionState = {
  questions: Map<
    string,
    {
      kind: string;
      kcIds: string[];
      askedAt: string;
      answered: boolean;
      graded: boolean;
    }
  >;
  attempts: ReplayAttempt[];
  record: ReviewRecord;
  clock: number;
};

/** The next moment of the session: every event is 10 s after the last. */
const tick = (state: SessionState) =>
  new Date((state.clock += 10_000)).toISOString();

/** The queue as code builds it for the next reply. */
function queueOf(course: Course, state: SessionState): ReviewGroup[] {
  return planReviewQueue({
    kcs: course.gold.kcs.map(({ id, name, type }) => ({
      id: course.id(id),
      name,
      type,
    })),
    schedules: new Map(
      DUE.map((goldId) => {
        const kcId = course.id(goldId);
        return [kcId, replay([course.prior(kcId)])!];
      }),
    ),
    priorities: Object.fromEntries(DUE.map((k) => [course.id(k), 1])),
    startedAt: new Date(START),
    minutesPerReview: MINUTES_PER_REVIEW,
    topicOf: course.topicOf,
    links: course.links,
    questions: [...state.questions.values()],
    attempts: state.attempts,
  });
}

function contextOf(queue: ReviewGroup[]): TutorContext {
  return {
    today: TODAY,
    examDate: EXAM_DATE,
    hasMap: true,
    phase: "build",
    goal: "good_grade",
    memory: "",
    mapPath: `/courses/${COURSE_ID}/map`,
    dueReviews: { kcs: [], more: 0 },
    todayPlan: { next: null, hint: null, fitLine: null },
    session: null,
    reviewQueue: queue,
  };
}

// --- One session ----------------------------------------------------------

/** One thing the session did, in order. KC ids are gold ids. */
type ReviewEvent =
  | { type: "ask"; id: string; kcIds: string[] }
  /** A `getTopic` call: the KCs it returned sources for. */
  | { type: "read"; kcIds: string[] }
  | { type: "answer"; questionId: string; labels: Record<string, Label> }
  | {
      type: "grade";
      questionId: string;
      results: Array<{ kcId: string; result: string }>;
    };

/** What a session did, as the checks read it. KC ids are gold ids. */
export type ReviewRecord = {
  /** The queue at the session's start, in order. */
  queue: Array<{ topicId: string | null; kcIds: string[] }>;
  events: ReviewEvent[];
  /** Per KC graded in the session: its card from all attempts and from the first only. */
  replays: Array<{ kcId: string; attempts: number; same: boolean }>;
  refusals: string[];
  calls: number;
  costUsd: number;
  end: "wrap_up" | "calls" | "replies";
};

/**
 * The scripted answer to a question on `kcIds` (gold ids): the first unused
 * answer sharing the most KCs, else the used one sharing the most.
 */
export function scriptedAnswer(
  answers: ScriptedAnswer[],
  used: Set<number>,
  kcIds: string[],
): ScriptedAnswer | null {
  const shared = (answer: ScriptedAnswer) =>
    Object.keys(answer.labels).filter((k) => kcIds.includes(k)).length;
  const best = (unused: boolean) =>
    answers
      .map((answer, index) => ({ answer, index, shared: shared(answer) }))
      .filter((a) => a.shared > 0 && used.has(a.index) !== unused)
      .toSorted((a, b) => b.shared - a.shared || a.index - b.index)[0];
  const pick = best(true) ?? best(false);
  if (!pick) return null;
  used.add(pick.index);
  return pick.answer;
}

/** The in-memory course: the tools' actions over the session's state. */
function courseActions(
  course: Course,
  state: SessionState,
  /** Asked in the current reply. */
  pending: Array<{ id: string; kcIds: string[] }>,
): TutorToolActions {
  const known = (id: string) => course.goldId(id)?.startsWith("KC") ?? false;
  const toGold = (ids: string[]) => ids.map((k) => course.goldId(k)!);
  const requireKnown = (kcIds: string[]) => {
    const unknown = kcIds.filter((id) => !known(id));
    if (unknown.length > 0) {
      throw new TutorToolError(
        `These are no KC ids of this Course: ${unknown.join(", ")}. Use the ids of the review queue.`,
      );
    }
  };
  const dueIds = new Set(DUE.map(course.id));
  const kcView = (kc: Course["gold"]["kcs"][number], withSources: boolean) => ({
    id: course.id(kc.id),
    name: kc.name,
    type: kc.type,
    description: kc.description,
    state: dueIds.has(course.id(kc.id)) ? ("due" as const) : ("new" as const),
    sources: withSources
      ? kc.sources.slice(0, 3).map((position) => ({
          chunkId: `chunk-${position}`,
          material: MATERIAL,
          pages: `p. ${course.chunk(position).page_from}`,
          link: `/courses/${COURSE_ID}/materials/${MATERIAL_ID}#chunk-${position}`,
          markdown: course.chunk(position).markdown,
        }))
      : [],
    findings: [],
  });
  return {
    loadStage: async () => null,
    saveStage: async () => false,
    searchMaterials: async () => [],
    isKc: () => false,
    findChunk: async () => null,
    saveMapFinding: async () => {
      throw new TutorToolError("This eval files no map Findings.");
    },
    getTopic: async (topicId, kcIds) => {
      if (kcIds) requireKnown(kcIds);
      if (topicId === null) {
        const kcs = course.gold.kcs.filter((kc) =>
          kcIds?.includes(course.id(kc.id)),
        );
        state.record.events.push({
          type: "read",
          kcIds: kcs.map((kc) => kc.id),
        });
        return {
          id: null,
          name: null,
          centralQuestion: null,
          kcs: kcs.map((kc) => kcView(kc, true)),
          anchors: null,
          readingSections: null,
        };
      }
      const topic = course.topics.find((t) => t.id === topicId);
      if (!topic) return null;
      const foreign = (kcIds ?? []).filter(
        (id) => course.topicOf.get(id) !== topicId,
      );
      if (foreign.length > 0) {
        throw new TutorToolError(
          `These KCs are not in this Topic: ${foreign.join(", ")}. Use the ids of its KCs.`,
        );
      }
      const wanted = new Set(kcIds ?? topic.kcs.map((kc) => course.id(kc.id)));
      state.record.events.push({ type: "read", kcIds: toGold([...wanted]) });
      return {
        id: topic.id,
        name: topic.name,
        centralQuestion: `What is ${topic.name}?`,
        kcs: topic.kcs.map((kc) => kcView(kc, wanted.has(course.id(kc.id)))),
        anchors: [],
        readingSections: [],
      };
    },
    findProblems: async (kcIds) => {
      requireKnown(kcIds);
      return {
        problems: [],
        note: "This Course has no Exercise on these KCs: pose a question of your own.",
      };
    },
    findReading: async () => null,
    remember: async () => {},
    compute: (program) => mathRunner.run(program),
    ask: async ({ kind, kcIds, problemId }) => {
      requireKnown(kcIds);
      if (problemId !== null) {
        throw new TutorToolError(
          `${problemId} is no Problem id of this Course: use an id from findProblems, or omit it.`,
        );
      }
      const id = uuid(0x1000 + state.questions.size);
      state.questions.set(id, {
        kind,
        kcIds,
        askedAt: tick(state),
        answered: false,
        graded: false,
      });
      state.record.events.push({ type: "ask", id, kcIds: toGold(kcIds) });
      pending.push({ id, kcIds: toGold(kcIds) });
      return { questionId: id, generatedProblemId: null };
    },
    findQuestion: async (questionId) => {
      const question = state.questions.get(questionId);
      if (!question) return null;
      return {
        kind: question.kind as "question",
        kcIds: question.kcIds,
        answered: question.answered,
        graded: question.graded,
        sessionEnded: false,
        finalAnswers: null,
      };
    },
    saveGrade: async ({ questionId, results, help, kind }) => {
      const question = state.questions.get(questionId)!;
      if (question.graded) return null;
      question.graded = true;
      const createdAt = tick(state);
      for (const { kcId, result } of results) {
        state.attempts.push({
          kcId,
          sessionId: REVIEW_SESSION,
          createdAt,
          kind,
          result,
          help,
          questionId,
          confidence: null,
          seconds: null,
        });
      }
      state.record.events.push({
        type: "grade",
        questionId,
        results: results.map(({ kcId, result }) => ({
          kcId: course.goldId(kcId)!,
          result,
        })),
      });
      return results.map(({ kcId, result }) => {
        const first = state.attempts.find((a) => a.kcId === kcId)!;
        const card = replay([course.prior(kcId), first])?.card ?? null;
        return {
          id: kcId,
          name: course.gold.kcs.find((kc) => course.id(kc.id) === kcId)!.name,
          result,
          state: result === "full" ? ("known" as const) : ("learning" as const),
          nextReview: card ? card.due.toISOString().slice(0, 10) : null,
          retrievability: null,
        };
      });
    },
  };
}

/**
 * Each KC graded in the session, replayed with all its attempts and with
 * only the session's first: only first attempts schedule, so both agree.
 */
function replays(course: Course, attempts: ReplayAttempt[]) {
  return [...Map.groupBy(attempts, (a) => a.kcId)].map(([kcId, own]) => {
    const prior = course.prior(kcId);
    const all = replay([prior, ...own])?.card;
    const first = replay([prior, own[0]!])?.card;
    return {
      kcId: course.goldId(kcId)!,
      attempts: own.length,
      same:
        all !== undefined &&
        first !== undefined &&
        all?.due.getTime() === first?.due.getTime() &&
        all?.stability === first?.stability &&
        all?.reps === first?.reps,
    };
  });
}

/** Runs one scripted session; sessions run one at a time. */
async function runSession({ answers }: Input): Promise<ReviewRecord> {
  const course = courseOf(await loadCourse());
  const record: ReviewRecord = {
    queue: [],
    events: [],
    replays: [],
    refusals: [],
    calls: 0,
    costUsd: 0,
    end: "replies",
  };
  const state: SessionState = {
    questions: new Map(),
    attempts: [],
    record,
    clock: START,
  };
  const pending: Array<{ id: string; kcIds: string[] }> = [];
  const tools = tutorTools(courseActions(course, state, pending));
  const used = new Set<number>();
  const messages: ModelMessage[] = [];
  const { model } = aiTask("chat");
  let message = { note: "", text: GREETING };

  for (let reply = 0; reply < MAX_REPLIES; reply++) {
    const queue = queueOf(course, state);
    if (reply === 0) {
      record.queue = queue.map((g) => ({
        topicId: g.topicId && course.goldId(g.topicId)!,
        kcIds: g.kcs.map((kc) => course.goldId(kc.id)!),
      }));
    }
    messages.push({ role: "user", content: `${message.note}${message.text}` });
    console.info(`  Student: ${message.text.slice(0, 100)}`);
    state.clock = Math.max(state.clock, START + reply * 120_000);

    pending.length = 0;
    const shown: string[] = [];
    const result = streamText({
      ...chatReplySettings(contextOf(queue)),
      messages,
      tools,
      prepareStep: async () => {
        await pace();
        return {};
      },
      stopWhen: [
        isStepCount(MAX_STEPS),
        endsReply,
        ({ steps }) => record.calls + steps.length >= SESSION_CALLS,
      ],
    });
    for await (const part of result.stream) {
      if (part.type === "error") throw part.error;
      if (part.type === "text-delta") shown.push(part.text);
      if (part.type === "tool-error") {
        const error =
          part.error instanceof Error ? part.error.message : String(part.error);
        record.refusals.push(`${part.toolName}: ${error}`);
      }
      if (part.type === "tool-call") {
        console.info(`    ${part.toolName} ${JSON.stringify(part.input)}`);
      }
      if (part.type === "finish-step") record.calls += 1;
    }
    record.costUsd += costUsd(model, tokenUsage(await result.totalUsage));
    messages.push(...(await result.response).messages);
    console.info(`  AI: ${shown.join("").replaceAll("\n", " ").slice(0, 300)}`);

    const question = pending.at(-1);
    if (question) {
      const answer = scriptedAnswer(answers, used, question.kcIds);
      state.questions.get(question.id)!.answered = true;
      record.events.push({
        type: "answer",
        questionId: question.id,
        labels: answer?.labels ?? {},
      });
      message = {
        note: `[My answer on the card of question ${question.id}:]\n\n`,
        text: answer?.text ?? UNSCRIPTED,
      };
    } else if (queueOf(course, state).every((g) => g.status === "done")) {
      record.end = "wrap_up";
      break;
    } else {
      message = { note: "", text: GO_ON };
    }
    if (record.calls >= SESSION_CALLS) {
      record.end = "calls";
      break;
    }
  }
  record.replays = replays(course, state.attempts);
  return record;
}

// One session at a time: a session's calls follow each other, and the rate
// limit counts per minute.
let queue: Promise<unknown> = Promise.resolve();

async function reviewTask(item: Input): Promise<string> {
  const run = queue.then(() => runSession(item));
  queue = run.catch(() => undefined);
  return JSON.stringify(await run);
}

// --- The checks -----------------------------------------------------------

type Check = { name: string; value: number; comment?: string };

const check = (name: string, passed: boolean, comment = ""): Check => ({
  name,
  value: passed ? 1 : 0,
  ...(comment && { comment }),
});

const covers = (ask: { kcIds: string[] }, kcIds: string[]) =>
  kcIds.every((k) => ask.kcIds.includes(k));

/** The code checks of one session, each 1 when it passes. */
export function checkSession(record: ReviewRecord): Check[] {
  const asks = record.events.flatMap((e, index) =>
    e.type === "ask" ? [{ ...e, index }] : [],
  );
  // A group's question asks a KC for the first time; a retry asks again.
  const seen = new Set<string>();
  const firsts = asks.filter((ask) => {
    const fresh = ask.kcIds.some((k) => !seen.has(k));
    for (const k of ask.kcIds) seen.add(k);
    return fresh;
  });
  const groupOf = (ask: { kcIds: string[] }) =>
    record.queue.findIndex((g) => g.kcIds.some((k) => ask.kcIds.includes(k)));

  // One question per group, covering all its KCs and no other group's.
  const perGroup = record.queue.map(
    (group) =>
      firsts.filter(
        (ask) =>
          covers(ask, group.kcIds) &&
          ask.kcIds.every((k) => group.kcIds.includes(k)),
      ).length,
  );
  const onePerGroup =
    record.queue.length > 0 &&
    firsts.length === record.queue.length &&
    perGroup.every((n) => n === 1);

  // No two groups of one Topic back to back while another Topic's is left.
  const backToBack = firsts.flatMap((ask, i) => {
    if (i === 0) return [];
    const topic = record.queue[groupOf(ask)]?.topicId ?? null;
    const before = record.queue[groupOf(firsts[i - 1]!)]?.topicId ?? null;
    if (topic === null || topic !== before) return [];
    const askedSoFar = firsts.slice(0, i);
    const otherLeft = record.queue.some(
      (g) =>
        g.topicId !== topic &&
        !askedSoFar.some((a) => g.kcIds.some((k) => a.kcIds.includes(k))),
    );
    return otherLeft ? [`${i}: ${topic}`] : [];
  });

  // After an answer below full: a re-teach (getTopic on the KC), then a
  // later question on it, after another group's question or at the end.
  const misses = record.events.flatMap((e, index) => {
    if (e.type !== "answer") return [];
    const ask = asks.find((a) => a.id === e.questionId);
    if (!ask || !firsts.includes(ask)) return [];
    return Object.entries(e.labels)
      .filter(([k, label]) => label === "below_full" && ask.kcIds.includes(k))
      .map(([kcId]) => ({ kcId, index }));
  });
  const unfixed = misses.flatMap(({ kcId, index }) => {
    const retry = asks.find((a) => a.index > index && a.kcIds.includes(kcId));
    const reteach = record.events.findIndex(
      (e, i) =>
        i > index &&
        i < (retry?.index ?? Infinity) &&
        e.type === "read" &&
        e.kcIds.includes(kcId),
    );
    if (!retry) return [`${kcId}: no retry`];
    if (reteach === -1) return [`${kcId}: no re-teach before the retry`];
    const between = firsts.some(
      (a) => a.index > index && a.index < retry.index,
    );
    const allAsked = record.queue.every((g) =>
      firsts.some((a) => a.index < retry.index && covers(a, g.kcIds)),
    );
    return between || allAsked ? [] : [`${kcId}: retried at once`];
  });

  const retried = record.replays.filter((r) => r.attempts > 1);
  const moved = record.replays.filter((r) => !r.same);

  const mismatches: string[] = [];
  let compared = 0;
  for (const e of record.events) {
    if (e.type !== "answer") continue;
    const ask = asks.find((a) => a.id === e.questionId);
    const grade = record.events.find(
      (g) => g.type === "grade" && g.questionId === e.questionId,
    );
    for (const [kcId, label] of Object.entries(e.labels)) {
      if (!ask?.kcIds.includes(kcId)) continue;
      compared += 1;
      const result =
        grade?.type === "grade"
          ? grade.results.find((r) => r.kcId === kcId)?.result
          : undefined;
      if (result === undefined || (label === "full") !== (result === "full")) {
        mismatches.push(
          `${kcId}: ${result ?? "not graded"}, labelled ${label}`,
        );
      }
    }
  }

  return [
    check(
      "one_ask_per_group",
      onePerGroup,
      `${record.queue.length} groups (${record.queue.map((g) => g.kcIds.join("+")).join(", ")}); ${firsts.length} first asks (${firsts.map((a) => a.kcIds.join("+")).join(", ")})`,
    ),
    check("interleaved", backToBack.length === 0, backToBack.join(", ")),
    check(
      "reteach_and_retry",
      misses.length > 0 && unfixed.length === 0,
      `${misses.length} answers below full${unfixed.length ? `: ${unfixed.join("; ")}` : ""}`,
    ),
    check(
      "first_attempts_schedule",
      retried.length > 0 && moved.length === 0,
      `${retried.length} KCs with more than one attempt${moved.length ? `; moved: ${moved.map((r) => r.kcId).join(", ")}` : ""}`,
    ),
    check(
      "grades_match_labels",
      compared > 0 && mismatches.length === 0,
      `${compared - mismatches.length} of ${compared}${mismatches.length ? `: ${mismatches.join("; ")}` : ""}`,
    ),
    check("wraps_up", record.end === "wrap_up", `ended by ${record.end}`),
  ];
}

const GATES = [
  "one_ask_per_group",
  "interleaved",
  "reteach_and_retry",
  "first_attempts_schedule",
];

const MAX_RUN_CALLS = 60;
const SESSIONS = 2;

type ScoreList = Array<{ name: string; value: unknown }>;

/** The gate: both sessions pass every gated check, in at most 60 calls. */
export function reviewGate(items: Array<{ evaluations: ScoreList }>) {
  const value = (item: { evaluations: ScoreList }, name: string) =>
    item.evaluations.find((e) => e.name === name)?.value;
  const passed = items.filter((item) =>
    GATES.every((gate) => value(item, gate) === 1),
  ).length;
  const sum = (name: string) =>
    items.reduce((total, item) => total + Number(value(item, name) ?? 0), 0);
  const calls = sum("model_calls");
  return {
    passed: passed === SESSIONS && calls <= MAX_RUN_CALLS,
    summary: `${passed} of ${SESSIONS} sessions passed every gated check, ${calls} model calls (at most ${MAX_RUN_CALLS}), $${sum("cost_usd").toFixed(4)}`,
  };
}

export const reviewEval: EvalDefinition<Input, null> = {
  name: "review",
  input,
  expectedOutput,
  task: reviewTask,
  evaluators: [
    async ({ output }) => {
      const record = JSON.parse(output) as ReviewRecord;
      return [
        ...checkSession(record),
        {
          name: "model_calls",
          value: record.calls,
          comment: record.refusals.join("; "),
        },
        { name: "cost_usd", value: record.costUsd },
      ];
    },
  ],
  gates: GATES,
  minPassRate: 1,
  aggregate: reviewGate,
};
