import { readFile } from "node:fs/promises";
import { isStepCount, streamText, type ModelMessage } from "ai";
import { z } from "zod";
import { chatReplySettings } from "@/features/chat/server";
import {
  endsReply,
  mathRunner,
  STAGES,
  TutorToolError,
  tutorTools,
  type Stage,
  type TutorContext,
  type TutorToolActions,
} from "@/features/study/server";
import { costUsd, tokenUsage } from "@/lib/ai/cost";
import { aiTask } from "@/lib/ai/models";
import type { EvalDefinition } from "./eval";

/**
 * A whole learn session (#180): the real Chat instructions, model settings
 * and tools teach the jet-engines gold course's first Topic in stages, with
 * in-memory actions as in `grade`. A scripted Student answers each `ask` from
 * the fixed answer for the question's stage and kind, each labelled per KC,
 * presses Done after each `showReading`, and otherwise says to go on. One
 * Student is mostly right, the other has planted errors.
 *
 * Code checks each session; the gate is that both pass, in a run of at most
 * 60 model calls.
 */

const KINDS = [
  "prequestion",
  "recall",
  "question",
  "problem",
  "rebuild",
  "mock_item",
] as const;

/** `full`, or `below_full` for partial or wrong. */
const LABELS = ["full", "below_full"] as const;
type Label = (typeof LABELS)[number];

const answerSchema = z.object({
  stage: z.enum(STAGES),
  /** The question kind it answers; `any` for every kind of its stage. */
  kind: z.enum([...KINDS, "any"]),
  text: z.string().min(1),
  /** By gold KC id: only the KCs the answer settles. */
  labels: z.record(z.string(), z.enum(LABELS)),
  /** Values of the answer the AI must not say before the Student does. */
  finalValues: z.array(z.string()).optional(),
});

type ScriptedAnswer = z.infer<typeof answerSchema>;

const input = z.object({
  /**
   * The Student's answers. Repeated questions of one stage and kind take the
   * next answer of that stage and kind, and the last one again after that.
   */
  answers: z.array(answerSchema).min(1),
});

type Input = z.infer<typeof input>;

const expectedOutput = z.null();

/** The most model calls of one session, half the run's 60. */
export const SESSION_CALLS = 30;
/** As in the Chat handler. */
const MAX_STEPS = 5;
const MAX_REPLIES = 16;

const GREETING = "Let's start studying.";
const GO_ON = "OK, let's go on.";
const DONE = "Done reading.";
/** What the Student says to a question the script has no answer for. */
const UNSCRIPTED = "I'm not sure how to answer this one.";

// --- The gold course's first Topic --------------------------------------

const GOLD = "evals/gold/jet-engines/gold.json";
const CHUNKS = "evals/gold/jet-engines/chunks.json";

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

/** A stable uuid per number, so the ids look like the app's. */
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const COURSE_ID = uuid(1);
const TOPIC_ID = uuid(2);
const SECTION_ID = uuid(3);
const EXERCISE_ID = uuid(4);
const MATERIAL_ID = uuid(5);
const MATERIAL = "Jet engines, Chapter 7";
const CENTRAL_QUESTION =
  "How does pushing air backwards move an engine forwards, and how much?";
/** The Topic's Reading section: the chapter's 7.1 and Example 7.1. */
const SECTION_CHUNKS = [1, 18, 19, 21];
/** Ex. 7.2: its question and solution chunks, and its key. */
const EXERCISE = {
  name: "Ex. 7.2a",
  question: 26,
  solution: 27,
  kcs: ["KC05", "KC06"],
  finalAnswers: [
    { label: "Net thrust", value: 20, unit: "kN" },
    { label: "Propulsive power", value: 4, unit: "MW" },
  ],
};

type Gold = z.infer<typeof goldSchema>;
type Chunk = z.infer<typeof chunksSchema>[number];

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

/** The first Topic and its ids: gold KC ids map to uuids and back. */
function topicOf({ gold, chunks }: { gold: Gold; chunks: Chunk[] }) {
  const bigIdea = gold.bigIdeas[0]!;
  const toId = new Map(gold.kcs.map((kc, i) => [kc.id, uuid(0x100 + i)]));
  const toGold = new Map([...toId].map(([goldId, id]) => [id, goldId]));
  const kcs = gold.kcs.filter((kc) => kc.bigIdea === bigIdea.id);
  const inTopic = new Set(kcs.map((kc) => kc.id));
  const anchors = [
    ...new Set(
      gold.prerequisites
        .filter((p) => inTopic.has(p.to) && !inTopic.has(p.from))
        .map((p) => p.from),
    ),
  ].map((goldId) => gold.kcs.find((kc) => kc.id === goldId)!);
  const chunk = (position: number) =>
    chunks.find((c) => c.position === position)!;
  const link = (position: number) =>
    `/courses/${COURSE_ID}/materials/${MATERIAL_ID}#chunk-${position}`;
  const pages = SECTION_CHUNKS.map((p) => chunk(p).page_from);
  return {
    name: bigIdea.name,
    kcs,
    anchors,
    id: (goldId: string) => toId.get(goldId)!,
    goldId: (id: string) => toGold.get(id),
    chunk,
    link,
    section: {
      id: SECTION_ID,
      label: `${MATERIAL}, pp. ${Math.min(...pages)}–${Math.max(...pages)}`,
      mode: "original" as const,
    },
  };
}

type Topic = ReturnType<typeof topicOf>;

/** The tutor context of a reply at `stage`, `minutes` into the session. */
function contextOf(topic: Topic, stage: Stage, minutes: number): TutorContext {
  return {
    today: "2026-11-02",
    examDate: "2026-12-03",
    hasMap: true,
    phase: "build",
    goal: "good_grade",
    memory: "",
    mapPath: `/courses/${COURSE_ID}/map`,
    dueReviews: { kcs: [], more: 0 },
    todayPlan: {
      next: {
        id: TOPIC_ID,
        name: topic.name,
        centralQuestion: CENTRAL_QUESTION,
        kcs: topic.kcs.map(({ id, name, type }) => ({
          id: topic.id(id),
          name,
          type,
          taught: false,
        })),
        anchors: topic.anchors.map(({ id, name }) => ({
          id: topic.id(id),
          name,
        })),
        readingSections: [topic.section],
      },
      hint: null,
      fitLine: null,
    },
    session: { stage, afterReview: "orient", minutes },
  };
}

// --- One session ----------------------------------------------------------

/** What a session did, as the checks read it. KC ids are gold ids. */
export type SessionRecord = {
  /** The start stage, then each stage moved to. */
  stages: Stage[];
  /** Readings left when each move was made, by index into `stages`. */
  readingLeft: boolean[];
  asks: Array<{
    id: string;
    /** The stage at the end of the step that asked it. */
    stage: Stage;
    kind: string;
    kcIds: string[];
  }>;
  answers: Array<{ questionId: string; labels: Record<string, Label> }>;
  grades: Array<{
    questionId: string;
    results: Array<{ kcId: string; result: string }>;
  }>;
  /** What the Student read, in order: the AI's text and cards, their own. */
  timeline: Array<{
    by: "ai" | "student";
    text: string;
    finalValues?: string[];
  }>;
  /** Every final value of the script. */
  finalValues: string[];
  /** The tool calls refused, as the AI read them. */
  refusals: string[];
  calls: number;
  costUsd: number;
  end: "close" | "calls" | "replies";
};

type Question = {
  kind: (typeof KINDS)[number];
  kcIds: string[];
  answered: boolean;
  graded: boolean;
  exercise: boolean;
};

/** The scripted answer to a question of `kind` at `stage`. */
export function scriptedAnswer(
  answers: ScriptedAnswer[],
  used: Map<string, number>,
  stage: Stage,
  kind: string,
): ScriptedAnswer | null {
  const exact = answers.filter((a) => a.stage === stage && a.kind === kind);
  const matching =
    exact.length > 0
      ? exact
      : answers.filter((a) => a.stage === stage && a.kind === "any");
  if (matching.length === 0) return null;
  const key = `${stage}/${matching[0]!.kind}`;
  const count = used.get(key) ?? 0;
  used.set(key, count + 1);
  return matching[Math.min(count, matching.length - 1)]!;
}

/** The in-memory course: the tools' actions over the session's state. */
function courseActions(
  topic: Topic,
  state: {
    stage: Stage;
    record: SessionRecord;
    questions: Map<string, Question>;
    done: Set<string>;
    /** Asked in the current step; given their stage at its end. */
    pending: Array<{ id: string; kind: string; kcIds: string[] }>;
  },
): TutorToolActions {
  const known = (id: string) => topic.goldId(id) !== undefined;
  const requireKnown = (kcIds: string[]) => {
    const unknown = kcIds.filter((id) => !known(id));
    if (unknown.length > 0) {
      throw new TutorToolError(
        `These are no KC ids of this Course: ${unknown.join(", ")}. Use the ids of the due reviews, the next Topic's KCs and their anchors.`,
      );
    }
  };
  const graded = new Set<string>();
  const stateOf = (goldId: string) =>
    graded.has(goldId) ? ("learning" as const) : ("new" as const);
  const exerciseKcs = EXERCISE.kcs.map(topic.id);
  return {
    loadStage: async () => ({
      stage: state.stage,
      afterReview: "orient",
      readingLeft: !state.done.has(SECTION_ID),
    }),
    saveStage: async (stage) => {
      if (state.stage === "close") return false;
      state.stage = stage;
      state.record.stages.push(stage);
      state.record.readingLeft.push(!state.done.has(SECTION_ID));
      return true;
    },
    searchMaterials: async () => [],
    isKc: () => false,
    findChunk: async () => null,
    saveMapFinding: async () => {
      throw new TutorToolError("This eval files no map Findings.");
    },
    getTopic: async (topicId, kcIds) => {
      if (topicId !== TOPIC_ID) return null;
      const foreign = (kcIds ?? []).filter(
        (id) => !topic.kcs.some((kc) => topic.id(kc.id) === id),
      );
      if (foreign.length > 0) {
        throw new TutorToolError(
          `These KCs are not in this Topic: ${foreign.join(", ")}. Use the ids of its KCs.`,
        );
      }
      const wanted = new Set(kcIds ?? topic.kcs.map((kc) => topic.id(kc.id)));
      return {
        id: TOPIC_ID,
        name: topic.name,
        centralQuestion: CENTRAL_QUESTION,
        kcs: topic.kcs.map((kc) => ({
          id: topic.id(kc.id),
          name: kc.name,
          type: kc.type,
          description: kc.description,
          state: stateOf(kc.id),
          sources: wanted.has(topic.id(kc.id))
            ? kc.sources.slice(0, 3).map((position) => ({
                chunkId: `chunk-${position}`,
                material: MATERIAL,
                pages: `p. ${topic.chunk(position).page_from}`,
                link: topic.link(position),
                markdown: topic.chunk(position).markdown,
              }))
            : [],
          findings: [],
        })),
        // Prior knowledge the Student has.
        anchors: topic.anchors.map((kc) => ({
          id: topic.id(kc.id),
          name: kc.name,
          state: "known" as const,
        })),
        readingSections: [
          { ...topic.section, done: state.done.has(SECTION_ID) },
        ],
      };
    },
    findProblems: async (kcIds) => {
      requireKnown(kcIds);
      const asked = [...state.questions.values()].some((q) => q.exercise);
      if (asked || !kcIds.some((id) => exerciseKcs.includes(id))) {
        return {
          problems: [],
          note: "The Student has tried every Exercise of this Course for these KCs: pose a problem of your own.",
        };
      }
      return {
        problems: [
          {
            id: EXERCISE_ID,
            source: "exercise" as const,
            name: EXERCISE.name,
            taskType: "compute thrust",
            difficulty: 3,
            question: topic.chunk(EXERCISE.question).markdown,
            link: topic.link(EXERCISE.question),
            kcs: EXERCISE.kcs.map((goldId) => ({
              id: topic.id(goldId),
              name: topic.kcs.find((kc) => kc.id === goldId)!.name,
            })),
            solution: {
              status: "from the Materials, and an AI solution agrees",
              markdown: topic.chunk(EXERCISE.solution).markdown,
            },
          },
        ],
      };
    },
    findReading: async (sectionId) =>
      sectionId === SECTION_ID
        ? {
            label: topic.section.label,
            mode: topic.section.mode,
            chunks: SECTION_CHUNKS.map((p) => topic.chunk(p).markdown),
            studyText: null,
          }
        : null,
    remember: async () => {},
    compute: (program) => mathRunner.run(program),
    ask: async ({ kind, kcIds, problemId }) => {
      requireKnown(kcIds);
      if (problemId !== null && problemId !== EXERCISE_ID) {
        throw new TutorToolError(
          `${problemId} is no Problem id of this Course: use an id from findProblems, or omit it.`,
        );
      }
      const id = uuid(0x1000 + state.questions.size);
      state.questions.set(id, {
        kind,
        kcIds,
        answered: false,
        graded: false,
        exercise: problemId !== null,
      });
      state.pending.push({
        id,
        kind,
        kcIds: kcIds.map((k) => topic.goldId(k)!),
      });
      return id;
    },
    findQuestion: async (questionId) => {
      const question = state.questions.get(questionId);
      if (!question) return null;
      return {
        kind: question.kind,
        kcIds: question.kcIds,
        answered: question.answered,
        graded: question.graded,
        sessionEnded: false,
        finalAnswers: question.exercise ? EXERCISE.finalAnswers : null,
      };
    },
    saveGrade: async ({ questionId, results }) => {
      const question = state.questions.get(questionId)!;
      if (question.graded) return null;
      question.graded = true;
      const gradedKcs = results.map(({ kcId, result }) => ({
        kcId: topic.goldId(kcId)!,
        result,
      }));
      state.record.grades.push({ questionId, results: gradedKcs });
      for (const { kcId } of gradedKcs) graded.add(kcId);
      return gradedKcs.map(({ kcId, result }) => ({
        id: topic.id(kcId),
        name: topic.kcs.find((kc) => kc.id === kcId)?.name ?? kcId,
        result,
        // First taught in this session, which is still open.
        state: "learning" as const,
        nextReview: null,
        retrievability: null,
      }));
    },
  };
}

/**
 * The least time between two model calls. The Gemini API's free tier allows
 * 15 requests per minute (a 429 with a 59 s retry delay, which the AI SDK's
 * retries don't wait out); `LEARN_EVAL_RPM` sets another rate, such as 5
 * for MiMo through the gateway.
 */
let lastCall = 0;

export async function pace() {
  const gap = 60_000 / Number(process.env.LEARN_EVAL_RPM ?? 12);
  const wait = lastCall + gap - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();
}

/** Runs one scripted session; sessions run one at a time. */
async function runSession({ answers }: Input): Promise<SessionRecord> {
  const topic = topicOf(await loadCourse());
  const record: SessionRecord = {
    stages: ["orient"],
    readingLeft: [true],
    asks: [],
    answers: [],
    grades: [],
    timeline: [],
    finalValues: [...new Set(answers.flatMap((a) => a.finalValues ?? []))],
    refusals: [],
    calls: 0,
    costUsd: 0,
    end: "replies",
  };
  const state = {
    stage: "orient" as Stage,
    record,
    questions: new Map<string, Question>(),
    done: new Set<string>(),
    pending: [] as Array<{ id: string; kind: string; kcIds: string[] }>,
  };
  const tools = tutorTools(courseActions(topic, state));
  const used = new Map<string, number>();
  const messages: ModelMessage[] = [];
  const { model } = aiTask("chat");
  let message: { note: string; text: string; answer?: ScriptedAnswer } = {
    note: "",
    text: GREETING,
  };

  for (let reply = 0; reply < MAX_REPLIES; reply++) {
    messages.push({ role: "user", content: `${message.note}${message.text}` });
    record.timeline.push({
      by: "student",
      text: message.text,
      ...(message.answer?.finalValues && {
        finalValues: message.answer.finalValues,
      }),
    });
    console.info(`  [${state.stage}] Student: ${message.text.slice(0, 100)}`);

    const asked: SessionRecord["asks"] = [];
    let shown: string | null = null;
    const shownText: string[] = [];
    const result = streamText({
      ...chatReplySettings(contextOf(topic, state.stage, reply * 2)),
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
      if (part.type === "text-delta") shownText.push(part.text);
      if (part.type === "tool-error") {
        const error =
          part.error instanceof Error ? part.error.message : String(part.error);
        record.refusals.push(`${part.toolName}: ${error}`);
      }
      if (part.type === "tool-call") {
        console.info(`    ${part.toolName} ${JSON.stringify(part.input)}`);
        const input = part.input as Record<string, unknown>;
        if (part.toolName === "ask") shownText.push(`\n\n${input.prompt}`);
        if (part.toolName === "showReading") {
          shownText.push(`\n\n${input.purpose}`);
        }
      }
      if (part.type === "tool-result" && part.toolName === "showReading") {
        shown = (part.input as { sectionId: string }).sectionId;
      }
      if (part.type === "finish-step") {
        record.calls += 1;
        asked.push(...state.pending.map((q) => ({ ...q, stage: state.stage })));
        state.pending = [];
      }
    }
    const usage = await result.totalUsage;
    record.costUsd += costUsd(model, tokenUsage(usage));
    messages.push(...(await result.response).messages);
    record.asks.push(...asked);
    const text = shownText.join("").trim();
    record.timeline.push({ by: "ai", text });
    console.info(`  AI: ${text.replaceAll("\n", " ").slice(0, 300)}`);

    const question = asked.at(-1);
    if (question) {
      const answer = scriptedAnswer(
        answers,
        used,
        question.stage,
        question.kind,
      );
      state.questions.get(question.id)!.answered = true;
      record.answers.push({
        questionId: question.id,
        labels: answer?.labels ?? {},
      });
      message = {
        note: `[My answer on the card of question ${question.id}:]\n\n`,
        text: answer?.text ?? UNSCRIPTED,
        ...(answer && { answer }),
      };
    } else if (shown !== null) {
      state.done.add(shown);
      message = { note: `[Done reading section ${shown}.]\n\n`, text: DONE };
    } else if (state.stage === "close") {
      record.end = "close";
      break;
    } else {
      message = { note: "", text: GO_ON };
    }
    if (record.calls >= SESSION_CALLS) {
      record.end = "calls";
      break;
    }
  }
  return record;
}

// One session at a time, even when the runner starts both at once: a
// session's calls follow each other, and the rate limit counts per minute.
let queue: Promise<unknown> = Promise.resolve();

async function learnTask(item: Input): Promise<string> {
  const run = queue.then(() => runSession(item));
  queue = run.catch(() => undefined);
  return JSON.stringify(await run);
}

// --- The checks -----------------------------------------------------------

/** The tools, which the Student must never see named. */
const TOOL_NAMES =
  /\b(getTopic|findProblems|showReading|setStage|remember|ask|grade)\(|\b(getTopic|findProblems|showReading|setStage)\b/;
/** Every id the AI sees is a uuid. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Text as a number search reads it: no LaTeX markup, spaces or thousands
 * separators, so "20{,}000\,\text{N}" reads "20000N".
 */
function plain(text: string) {
  return text
    .replace(/\\(text|mathrm|mathbf)\b/g, "")
    .replace(/\\[,;: ]/g, "")
    .replace(/[{}$\s]/g, "")
    .replace(/(?<=\d)[,'](?=\d{3})/g, "");
}

function mentions(text: string, value: string) {
  const escaped = plain(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Not part of a longer number; a full stop may end the sentence.
  return new RegExp(`(?<![\\d.])${escaped}(?!\\.?\\d)`).test(plain(text));
}

type Check = { name: string; value: number; comment?: string };

const check = (name: string, passed: boolean, comment = ""): Check => ({
  name,
  value: passed ? 1 : 0,
  ...(comment && { comment }),
});

/** The code checks of one session, each 1 when it passes. */
export function checkSession(record: SessionRecord): Check[] {
  // Each move goes forward, or from work back to read for a section left.
  const backwards = record.stages.flatMap((to, i) => {
    const from = record.stages[i - 1];
    if (from === undefined) return [];
    const forward = STAGES.indexOf(to) >= STAGES.indexOf(from);
    const reread = from === "work" && to === "read" && record.readingLeft[i];
    return forward || reread ? [] : [`${from}→${to}`];
  });

  const noKcs = record.asks.filter((a) => a.kcIds.length === 0);

  const mismatches: string[] = [];
  let compared = 0;
  for (const { questionId, labels } of record.answers) {
    if (Object.keys(labels).length === 0) continue;
    const grade = record.grades.find((g) => g.questionId === questionId);
    const ask = record.asks.find((a) => a.id === questionId);
    for (const [kcId, label] of Object.entries(labels)) {
      if (!ask?.kcIds.includes(kcId)) continue;
      compared += 1;
      const result = grade?.results.find((r) => r.kcId === kcId)?.result;
      const matches =
        result !== undefined && (label === "full") === (result === "full");
      if (!matches) {
        mismatches.push(
          `${ask.stage}/${ask.kind} ${kcId}: ${result ?? "not graded"}, labelled ${label}`,
        );
      }
    }
  }

  // A value the Student gives must not appear in what the AI showed before
  // that answer, or anywhere when the Student never gave it.
  const early = record.finalValues.filter((value) => {
    const attempt = record.timeline.findIndex((entry) =>
      entry.finalValues?.includes(value),
    );
    return record.timeline
      .slice(0, attempt === -1 ? undefined : attempt)
      .some((entry) => entry.by === "ai" && mentions(entry.text, value));
  });

  const aiText = record.timeline
    .filter((e) => e.by === "ai")
    .map((e) => e.text)
    .join("\n")
    // A link's target holds ids, but the Student sees only its label.
    .replace(/\]\([^)]*\)/g, "]");
  const named = [UUID.exec(aiText)?.[0], TOOL_NAMES.exec(aiText)?.[0]].filter(
    Boolean,
  );

  const work = record.asks.filter((a) => a.stage === "work");
  const workKcs =
    work.length === 0
      ? 0
      : work.reduce((sum, a) => sum + a.kcIds.length, 0) / work.length;

  return [
    check(
      "stage_order",
      backwards.length === 0,
      `${record.stages.join(" → ")}${backwards.length ? `; back: ${backwards.join(", ")}` : ""}`,
    ),
    check(
      "ask_kc_ids",
      record.asks.length > 0 && noKcs.length === 0,
      `${record.asks.length} asks, ${noKcs.length} without KC ids`,
    ),
    check(
      "grades_match_labels",
      compared > 0 && mismatches.length === 0,
      `${compared - mismatches.length} of ${compared} labelled KC grades match${mismatches.length ? `: ${mismatches.join("; ")}` : ""}`,
    ),
    check("no_early_final_value", early.length === 0, early.join(", ")),
    check("no_ids_or_tool_names", named.length === 0, named.join(", ")),
    check(
      "work_kcs",
      workKcs >= 2,
      `${work.length} work questions, ${workKcs.toFixed(1)} KCs on average`,
    ),
    check("reaches_close", record.end === "close", `ended by ${record.end}`),
  ];
}

const GATES = [
  "stage_order",
  "ask_kc_ids",
  "grades_match_labels",
  "no_early_final_value",
  "no_ids_or_tool_names",
  "work_kcs",
  "reaches_close",
];

/** The most model calls of a run. */
const MAX_RUN_CALLS = 60;
const SESSIONS = 2;

type ScoreList = Array<{ name: string; value: unknown }>;

/** The gate: both sessions pass every check, in at most 60 model calls. */
export function learnGate(items: Array<{ evaluations: ScoreList }>) {
  const value = (item: { evaluations: ScoreList }, name: string) =>
    item.evaluations.find((e) => e.name === name)?.value;
  const passed = items.filter((item) =>
    GATES.every((gate) => value(item, gate) === 1),
  ).length;
  const calls = items.reduce(
    (sum, item) => sum + Number(value(item, "model_calls") ?? 0),
    0,
  );
  const cost = items.reduce(
    (sum, item) => sum + Number(value(item, "cost_usd") ?? 0),
    0,
  );
  return {
    passed: passed === SESSIONS && calls <= MAX_RUN_CALLS,
    summary: `${passed} of ${SESSIONS} sessions passed every check, ${calls} model calls (at most ${MAX_RUN_CALLS}), $${cost.toFixed(4)}`,
  };
}

export const learnEval: EvalDefinition<Input, null> = {
  name: "learn",
  input,
  expectedOutput,
  task: learnTask,
  evaluators: [
    async ({ output }) => {
      const record = JSON.parse(output) as SessionRecord;
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
  aggregate: learnGate,
};
