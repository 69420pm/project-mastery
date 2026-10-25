import { readFile } from "node:fs/promises";
import { generateText, isStepCount, type ModelMessage } from "ai";
import { z } from "zod";
import { chatReplySettings } from "@/features/chat/server";
import {
  endsReply,
  tutorTools,
  type TutorContext,
  type TutorToolActions,
} from "@/features/study/server";
import type { EvalDefinition } from "./eval";

/**
 * The AI's `grade` call (#173): given a Question it asked on a question card and
 * the Student's answer, how often does it label the KCs wrong, in particular
 * `full` when the answer is not. Runs the real Chat instructions, model
 * settings and tools with the question asked and the answer given, and scores
 * the verdict that `grade` stores, after its numeric check of the final value
 * against the Exercise's key. Cases are drafted on the jet-engines gold
 * course; their labels are drafts until the maintainer confirms them.
 *
 * Gates over the whole dataset: false-full rate at most 5% and label
 * accuracy at least 85%. Help-level accuracy is reported only.
 */

const RESULTS = ["full", "partial", "wrong"] as const;
const HELPS = ["none", "some", "solution_shown"] as const;

const turnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const input = z.object({
  question: z.object({
    kind: z.enum(["prequestion", "recall", "question", "problem"]),
    prompt: z.string(),
    kcIds: z.array(z.string()).min(1),
    /** The Exercise's numeric key; null for the AI's own question. */
    finalAnswers: z
      .array(
        z.object({
          label: z.string(),
          value: z.number(),
          unit: z.string().nullable(),
        }),
      )
      .nullable(),
  }),
  /** What the AI has read: the Exercise's solution or the KCs' sources. */
  reference: z.string(),
  /** The side talk between the question and the answer, such as a hint. */
  aside: z.array(turnSchema).optional(),
  answer: z.string(),
});

const expectedOutput = z.object({
  /** "draft" until the maintainer confirms the labels. */
  labelStatus: z.enum(["draft", "confirmed"]),
  kcs: z.array(z.object({ kcId: z.string(), result: z.enum(RESULTS) })),
  help: z.enum(HELPS),
});

type Input = z.infer<typeof input>;
type Expected = z.infer<typeof expectedOutput>;

/** What the task returns: the verdict `grade` stored, as JSON. */
const verdictSchema = z.object({
  graded: z.boolean(),
  results: z.array(z.object({ kcId: z.string(), result: z.enum(RESULTS) })),
  help: z.enum(HELPS).nullable(),
  check: z.enum(["match", "mismatch"]).nullable(),
});

const GOLD = "evals/gold/jet-engines/gold.json";

const goldSchema = z.object({
  bigIdeas: z.array(z.object({ id: z.string(), name: z.string() })),
  kcs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      type: z.string(),
      bigIdea: z.string().nullable(),
    }),
  ),
});

let goldCache: Promise<z.infer<typeof goldSchema>> | undefined;
function loadGold() {
  goldCache ??= readFile(GOLD, "utf8").then((text) =>
    goldSchema.parse(JSON.parse(text)),
  );
  return goldCache;
}

/**
 * The gold course's first Big idea as the next Topic, so the instructions
 * read like a real Chat.
 */
function contextOf(gold: z.infer<typeof goldSchema>): TutorContext {
  const [first] = gold.bigIdeas;
  return {
    today: "2026-11-02",
    examDate: "2026-12-03",
    hasMap: true,
    phase: "build",
    goal: "good_grade",
    memory: "",
    mapPath: "/courses/00000000-0000-4000-8000-000000000000/map",
    dueReviews: { kcs: [], more: 0 },
    todayPlan: {
      next: first
        ? {
            id: first.id,
            name: first.name,
            centralQuestion: `What is ${first.name} about?`,
            kcs: gold.kcs
              .filter((kc) => kc.bigIdea === first.id)
              .map(({ id, name, type }) => ({ id, name, type, taught: false })),
            anchors: [],
          }
        : null,
      hint: null,
      fitLine: null,
    },
  };
}

const QUESTION_ID = "question-under-test";

/** The Chat so far: the sources read, the question asked, then the answer. */
function chatBefore(item: Input, gold: z.infer<typeof goldSchema>) {
  const { question } = item;
  const kcs = question.kcIds.map((id) => {
    const kc = gold.kcs.find((candidate) => candidate.id === id);
    if (!kc) throw new Error(`${id} is no KC of the gold course.`);
    return kc;
  });
  const isExercise = question.finalAnswers !== null;
  const read = isExercise
    ? {
        toolName: "findExercises",
        input: { kcIds: question.kcIds },
        output: {
          exercises: [
            {
              id: "exercise-under-test",
              name: "Exercise",
              taskType: "compute",
              difficulty: 2,
              question: question.prompt,
              link: "/materials/jet-engines",
              kcs: kcs.map(({ id, name }) => ({ id, name })),
              solution: { status: "verified", markdown: item.reference },
            },
          ],
        },
      }
    : {
        toolName: "readKcs",
        input: { kcIds: question.kcIds },
        output: {
          kcs: kcs.map(({ id, name, type, description }) => ({
            id,
            name,
            type,
            description,
            sources: [
              {
                material:
                  "Chapter 7: The Physics and Engineering of Jet Engines",
                pages: "pp. 185–189",
                link: "/materials/jet-engines",
                markdown: item.reference,
              },
            ],
          })),
        },
      };

  const messages: ModelMessage[] = [
    { role: "user", content: "Let's study." },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "read-1",
          toolName: read.toolName,
          input: read.input,
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "read-1",
          toolName: read.toolName,
          output: { type: "json", value: read.output },
        },
      ],
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "ask-1",
          toolName: "ask",
          input: {
            kind: question.kind,
            prompt: question.prompt,
            kcIds: question.kcIds,
          },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "ask-1",
          toolName: "ask",
          output: { type: "json", value: { questionId: QUESTION_ID } },
        },
      ],
    },
    ...(item.aside ?? []).map(
      ({ role, content }) => ({ role, content }) as ModelMessage,
    ),
    // The note the Chat handler puts before a card's answer.
    {
      role: "user",
      content: `[My answer on the card of question ${QUESTION_ID}:]\n\n${item.answer}`,
    },
  ];
  return messages;
}

const MAX_STEPS = 6;

async function gradeTask(item: Input): Promise<string> {
  const gold = await loadGold();
  const { question } = item;
  let stored: z.infer<typeof verdictSchema> | undefined;

  const unused = async () => {
    throw new Error("The eval's AI used a tool the eval does not serve.");
  };
  const actions: TutorToolActions = {
    // Served as the Chat showed them in the history above.
    readKcs: async () => [],
    findExercises: async () => ({ exercises: [] }),
    remember: unused,
    ask: unused,
    findReading: unused,
    loadStage: unused,
    saveStage: unused,
    findQuestion: async (id) =>
      id === QUESTION_ID
        ? {
            kind: question.kind,
            kcIds: question.kcIds,
            answered: true,
            graded: stored !== undefined,
            sessionEnded: false,
            finalAnswers: question.finalAnswers,
          }
        : null,
    saveGrade: async ({ kind, help, results, check }) => {
      void kind;
      stored = {
        graded: true,
        results: results.map(({ kcId, result }) => ({ kcId, result })),
        help,
        check,
      };
      return results.map(({ kcId, result }) => ({
        id: kcId,
        name: gold.kcs.find((kc) => kc.id === kcId)?.name ?? kcId,
        result,
        // First taught in this session, which is still open.
        state: "learning" as const,
        nextReview: null,
        retrievability: null,
      }));
    },
  };

  await generateText({
    ...chatReplySettings(contextOf(gold)),
    messages: chatBefore(item, gold),
    tools: tutorTools(actions),
    // Like the handler: a reply ends at `ask` or `showReading`; the eval
    // also ends at the stored grade, whose feedback text it doesn't score.
    stopWhen: [isStepCount(MAX_STEPS), endsReply, () => stored !== undefined],
  });

  const verdict: z.infer<typeof verdictSchema> = stored ?? {
    graded: false,
    results: [],
    help: null,
    check: null,
  };
  return JSON.stringify(verdict);
}

/** What one item adds to the counts of the gates. */
export function scoreGrade(output: string, expected: Expected) {
  const verdict = verdictSchema.parse(JSON.parse(output));
  const given = new Map(verdict.results.map((r) => [r.kcId, r.result]));
  let correct = 0;
  let nonFull = 0;
  let falseFull = 0;
  for (const { kcId, result } of expected.kcs) {
    if (given.get(kcId) === result) correct += 1;
    if (result !== "full") {
      nonFull += 1;
      if (given.get(kcId) === "full") falseFull += 1;
    }
  }
  return {
    graded: verdict.graded ? 1 : 0,
    kcs: expected.kcs.length,
    correct,
    nonFull,
    falseFull,
    helpCorrect: verdict.help === expected.help ? 1 : 0,
  };
}

/** Gate thresholds over the whole dataset. */
const MAX_FALSE_FULL_RATE = 0.05;
const MIN_LABEL_ACCURACY = 0.85;

type ScoreList = Array<{ name: string; value: unknown }>;

function sum(items: Array<{ evaluations: ScoreList }>, name: string) {
  return items.reduce((total, { evaluations }) => {
    const score = evaluations.find((e) => e.name === name)?.value;
    return total + (typeof score === "number" ? score : 0);
  }, 0);
}

const percent = (part: number, total: number) =>
  total === 0 ? "n/a" : `${((100 * part) / total).toFixed(1)}%`;

/** The gate verdict, with the help-level accuracy reported. */
export function gradeGates(items: Array<{ evaluations: ScoreList }>) {
  const kcs = sum(items, "kcs");
  const correct = sum(items, "correct");
  const nonFull = sum(items, "non_full");
  const falseFull = sum(items, "false_full");
  const helpCorrect = sum(items, "help_correct");
  const graded = sum(items, "graded");
  const accuracy = kcs === 0 ? 0 : correct / kcs;
  const falseFullRate = nonFull === 0 ? 1 : falseFull / nonFull;
  return {
    passed:
      falseFullRate <= MAX_FALSE_FULL_RATE && accuracy >= MIN_LABEL_ACCURACY,
    summary: `false-full rate ${percent(falseFull, nonFull)} (${falseFull} of ${nonFull} KCs expected below full; at most ${MAX_FALSE_FULL_RATE * 100}%), label accuracy ${percent(correct, kcs)} (${correct} of ${kcs}; at least ${MIN_LABEL_ACCURACY * 100}%), help-level accuracy ${percent(helpCorrect, items.length)} (reported), graded ${graded} of ${items.length} cases`,
  };
}

export const gradeEval: EvalDefinition<Input, Expected> = {
  name: "grade",
  input,
  expectedOutput,
  task: gradeTask,
  evaluators: [
    async ({ output, expectedOutput: expected }) => {
      const score = scoreGrade(output, expected!);
      const kcResults = JSON.parse(output) as {
        results: Array<{ kcId: string; result: string }>;
      };
      const comment = `given ${kcResults.results.map((r) => `${r.kcId}=${r.result}`).join(" ") || "no grade"}; expected ${expected!.kcs.map((r) => `${r.kcId}=${r.result}`).join(" ")}`;
      return [
        { name: "graded", value: score.graded, comment },
        { name: "kcs", value: score.kcs },
        { name: "correct", value: score.correct },
        { name: "non_full", value: score.nonFull },
        { name: "false_full", value: score.falseFull },
        { name: "help_correct", value: score.helpCorrect },
      ];
    },
  ],
  gates: [],
  minPassRate: 0,
  aggregate: gradeGates,
};
