import { hasToolCall, tool } from "ai";
import { z } from "zod";
import {
  checkAnswers,
  MAX_ANSWER_LENGTH,
  worstCheck,
  type AnswerCheck,
  type AnswerKey,
} from "@/features/knowledge-map/server";
import { computeTool } from "@/features/study/ai/compute-tool";
import type { ProgramRun } from "@/features/study/server/math-runner";
import type {
  AskedProblem,
  AttemptHelp,
  AttemptResult,
  ProblemView,
  GradedKc,
  ReadingView,
  SourceChunkView,
  TopicView,
} from "@/features/study/types";

/** What `findProblems` takes: KC ids of the Course. */
const kcIdsInputSchema = z.object({
  kcIds: z
    .array(z.string())
    .min(1)
    .max(8)
    .describe("The ids of 1 to 8 KCs of this Course."),
});

/** The most KCs one question tests, as many as a Topic has at most. */
const MAX_QUESTION_KCS = 12;

/**
 * What `getTopic` takes: a Topic and, for source chunks, some of its KCs; or,
 * without a Topic, KCs of the Course alone.
 */
const getTopicInputSchema = z.object({
  topicId: z
    .string()
    .nullish()
    .describe(
      "The id of a Topic of this Course; omit it to read KCs that have no Topic id, by kcIds alone.",
    ),
  kcIds: z
    .array(z.string())
    .min(1)
    .max(MAX_QUESTION_KCS)
    .nullish()
    .describe(
      "The ids of KCs to read the source chunks of: of the Topic, or every KC of it when omitted; without a Topic, of the Course, and then required.",
    ),
});

/** What `ask` takes: one graded question, shown in the Chat. */
const askInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(20_000)
    .describe(
      "The question as the Student reads it in the Chat, in Markdown with LaTeX. Complete on its own: give all data the Student needs.",
    ),
  kcIds: z
    .array(z.string())
    .min(1)
    .max(MAX_QUESTION_KCS)
    .describe("The ids of the 1 to 12 KCs of this Course the question tests."),
  problemId: z
    .string()
    .nullish()
    .describe(
      "The id of the Problem from findProblems when the question poses one; omit it for your own question.",
    ),
});

/** What `grade` takes: the verdict on the Student's answer to the open Question. */
const gradeInputSchema = z.object({
  noAnswer: z
    .boolean()
    .nullish()
    .describe(
      "true when the Student moved on instead of answering: closes the Question without results. Leave out results and help then.",
    ),
  results: z
    .array(
      z.object({
        kcId: z.string(),
        result: z
          .enum(["full", "partial", "wrong"])
          .describe(
            "full: the answer shows this KC right; partial: the right idea with a gap or slip; wrong: missing or wrong.",
          ),
      }),
    )
    .min(1)
    .max(MAX_QUESTION_KCS)
    .nullish()
    .describe("One result for each of the question's KCs, each KC once."),
  help: z
    .enum(["none", "some", "solution_shown"])
    .nullish()
    .describe(
      "How much you helped on this question before the answer: none, some (hints or corrections), or solution_shown when you showed or walked through the solution.",
    ),
  finalValues: z
    .array(
      z.object({
        label: z
          .string()
          .max(200)
          .nullish()
          .describe(
            "The label of the final result it answers; may be left out when the question has one.",
          ),
        value: z
          .string()
          .max(MAX_ANSWER_LENGTH)
          .describe(
            'The Student\'s value as mathjs, such as "17.5 kN", "[[1, 2], [0, 1]]", "[2, -3]", "n + 1" or "3 + 4i".',
          ),
      }),
    )
    .max(10)
    .nullish()
    .describe(
      "For a question with final results: the Student's final value for each one they gave, even when it looks wrong. Leave out a result the Student gave no value for.",
    ),
});

type GradeInput = z.infer<typeof gradeInputSchema>;

/** The session's newest Question as `ask` and `grade` check it. */
export type QuestionToGrade = {
  id: string;
  /** The live KCs it tests. */
  kcIds: string[];
  /** The KCs it tested that were retired since, whose results are dropped. */
  retiredKcIds: string[];
  answered: boolean;
  graded: boolean;
  /** Whether its Study session has ended, which closes it for grading. */
  sessionEnded: boolean;
  /** Its Exercise's or generated Problem's answer keys; null without any. */
  finalAnswers: AnswerKey[] | null;
};

/** The worst check of the final values: null when the question has no keys. */
export type FinalValueCheck = AnswerCheck | null;

/** What `remember` takes: one line for the Memory. */
const rememberInputSchema = z.object({
  text: z
    .string()
    .min(1)
    .max(300)
    .regex(/^[^\r\n]+$/, "One line, without line breaks.")
    .describe("One line of at most 300 characters, without line breaks."),
});

/** What `searchMaterials` takes: one line to search the Course by meaning. */
const searchMaterialsInputSchema = z.object({
  query: rememberInputSchema.shape.text.describe(
    "What to look for, in one line of at most 300 characters, as a question or a phrase from the Materials.",
  ),
});

/** What `showReading` takes: a Reading section and why the Student reads it. */
const showReadingInputSchema = z.object({
  sectionId: z.string().describe("The id of a Reading section of a Topic."),
  purpose: rememberInputSchema.shape.text.describe(
    "The question the reading answers, which the Student reads it for: one line of at most 300 characters.",
  ),
});

/**
 * What the tools do. A refusal, such as an id that is no KC of the Course,
 * throws a `TutorToolError`, whose message the model sees.
 */
export type TutorToolActions = {
  /**
   * A Topic of the Course with the source chunks of `kcIds`, or of all its
   * KCs when none; null for an id that is no Topic of the Course. Without a
   * Topic, only the KCs of `kcIds`, with their source chunks. Throws a
   * `TutorToolError` for a KC that is not of the Topic, or of the Course.
   */
  getTopic: (
    topicId: string | null,
    kcIds?: string[],
  ) => Promise<TopicView | null>;
  /**
   * Up to 4 embedded chunks of the Course nearest to the query by meaning,
   * nearest first. Throws a `TutorToolError` when it can't search.
   */
  searchMaterials: (query: string) => Promise<SourceChunkView[]>;
  /** A note, without Problems, tells the model why there are none. */
  findProblems: (
    kcIds: string[],
  ) => Promise<{ problems: ProblemView[]; note?: string }>;
  /** A Reading section of the Course; null for any other id. */
  findReading: (sectionId: string) => Promise<ReadingView | null>;
  /** Appends one line to the Course's Memory. */
  remember: (text: string) => Promise<void>;
  /**
   * Stores a question in the Chat's Study session; returns its id, and the
   * Problem it poses, which the Chat shows. Throws a `TutorToolError` for a
   * `problemId` that is no Problem of the Course.
   */
  ask: (question: {
    prompt: string;
    kcIds: string[];
    problemId: string | null;
  }) => Promise<{ questionId: string; problem: AskedProblem | null }>;
  /** The newest Question of the Chat's Study session; null without one. */
  findQuestion: () => Promise<QuestionToGrade | null>;
  /**
   * Marks the question graded and stores one attempt per KC; returns each
   * KC's new recall band, or null when it was graded in the meantime.
   */
  saveGrade: (grade: {
    questionId: string;
    help: AttemptHelp;
    results: Array<{ kcId: string; result: AttemptResult }>;
    check: FinalValueCheck;
  }) => Promise<GradedKc[] | null>;
  /**
   * Marks the question graded without attempts; false when it was graded
   * in the meantime.
   */
  closeQuestion: (questionId: string) => Promise<boolean>;
  /** Runs a mathjs program through the math runner. */
  compute: (program: string) => Promise<ProgramRun>;
};

/** A refused tool call: its message tells the model what to fix. */
export class TutorToolError extends Error {
  override name = "TutorToolError";
}

/** The tools the AI tutors with in a Chat. */
export function tutorTools(actions: TutorToolActions) {
  return {
    getTopic: tool({
      description:
        "Read a Topic of this Course before teaching it: its central question, its KCs in order with their description, recall band (new, strong, fading or weak), recall today (0 to 1) and what each assumes from outside the Materials, its anchors with their band and its Reading sections. The KCs you give in kcIds (all of the Topic's when omitted) come with up to 3 source chunks from the Course's Materials in reading order, each with its Markdown, Material, pages and a link to cite. Without a topicId, it reads the KCs in kcIds alone, with the same facts and source chunks.",
      inputSchema: getTopicInputSchema,
      execute: async ({ topicId, kcIds }) => {
        if (!topicId && !kcIds) {
          throw new TutorToolError(
            "Give a topicId, or the kcIds of the KCs to read without one.",
          );
        }
        const topic = await actions.getTopic(
          topicId || null,
          kcIds ?? undefined,
        );
        if (!topic) {
          throw new TutorToolError(
            `${topicId} is no Topic id of this Course: use the id of one of its Topics.`,
          );
        }
        return topic;
      },
    }),
    searchMaterials: tool({
      description:
        "Search all of this Course's Materials by meaning: up to 4 chunks nearest to your query, each with its chunk id, Markdown, Material, pages and a link to cite. Use it when getTopic's source chunks don't answer a question, or to check a KC's description against the Materials. Chunks of a Material still being parsed may be missing.",
      inputSchema: searchMaterialsInputSchema,
      execute: async ({ query }) => {
        const chunks = await actions.searchMaterials(query);
        return chunks.length > 0
          ? { chunks }
          : {
              chunks,
              note: "No chunk of this Course is searchable yet: its Materials are not parsed, or have no text.",
            };
      },
    }),
    findProblems: tool({
      description:
        "Find up to 3 Problems for the given KCs that test any of them: unseen ones first, then those not asked in the last 14 days; Exercises of this Course first, then Problems generated for it, ranked to vary and step up in difficulty. Each comes with its source (old_exam, exercise, or a generated variant of an Exercise or new Problem), its question, the KCs it tests, a link to cite (null for a generated Problem) and its solution, labelled with where it comes from. Pose the Problem you pick through ask with its problemId, never as text; never show the solution before the Student has tried. A generated solution without a program may be wrong: check it yourself before relying on it.",
      inputSchema: kcIdsInputSchema,
      execute: async ({ kcIds }) => actions.findProblems(kcIds),
    }),
    remember: tool({
      description:
        "Save one line to your Memory of this Student in this Course, which you read in every later Chat: something that will help you tutor them, such as a preference, how they like to learn or their context. The date is added for you.",
      inputSchema: rememberInputSchema,
      execute: async ({ text }) => {
        await actions.remember(text);
        return { ok: true };
      },
    }),
    ask: tool({
      description:
        "Ask the Student a graded question: it shows in the Chat, and ends your reply. The Student's next messages are their answer, which you grade with grade. With a problemId, the Chat shows the Problem's own statement and page in place of your prompt. Write any lead-in before calling it, and don't repeat the question in your text. Refused while the open Question is answered but not graded: grade it first.",
      inputSchema: askInputSchema,
      execute: async ({ problemId, ...question }) => {
        const open = await actions.findQuestion();
        if (open && open.answered && !open.graded) {
          throw new TutorToolError(
            "The Student answered the open Question: grade it first, with noAnswer when they moved on.",
          );
        }
        const { questionId, problem } = await actions.ask({
          ...question,
          problemId: problemId ?? null,
        });
        return problem === null ? { questionId } : { questionId, problem };
      },
    }),
    showReading: tool({
      description:
        "Open a Reading section of the course's pages for the Student to read, with the question they read it for: it shows on a reading card, opens the pages beside the Chat and ends your reply. Write a short lead-in first, and don't repeat the question in your text. Returns the section's label and its chunks' Markdown in order, so you can ask about what they read.",
      inputSchema: showReadingInputSchema,
      execute: async ({ sectionId }) => showReading(actions, sectionId),
    }),
    grade: tool({
      description:
        "Grade the Student's answer to the open Question, the one you asked last with ask, before you give feedback: a result for each of its KCs, how much you helped and, for a question with final results, the Student's final values. When the Student moved on instead of answering, give only noAnswer: true. Code checks each value against its key: numbers and units at 1% tolerance, vectors and matrices element by element, expressions at sample points. On a mismatch every full becomes partial. Returns each KC's result, its recall band (new, strong, fading or weak), its next review date (YYYY-MM-DD) and recall today (0 to 1), and the check: match, mismatch, unchecked (a value code doesn't compare, or a result without a value) or null when the question has no final results.",
      inputSchema: gradeInputSchema,
      execute: async (input) => grade(actions, input),
    }),
    compute: computeTool(actions.compute),
  };
}

/** The `showReading` call: a Reading section of the Course. */
async function showReading(
  actions: TutorToolActions,
  sectionId: string,
): Promise<ReadingView> {
  const section = await actions.findReading(sectionId);
  if (!section) {
    throw new TutorToolError(
      `${sectionId} is no Reading section of this Course: use a section id that getTopic lists.`,
    );
  }
  return section;
}

const alreadyGraded = "This question is already graded.";

/**
 * The `grade` call's rules, on the session's open Question: `noAnswer`
 * closes it without attempts. Otherwise one result for each live KC of an
 * answered Question, results for KCs retired since the ask dropped, and the
 * check of its final values against its keys, which turns every `full` into
 * `partial` on a mismatch. A `full` needs a value for every key, so each
 * check runs.
 */
async function grade(
  actions: TutorToolActions,
  input: GradeInput,
): Promise<{ kcs: GradedKc[]; check: FinalValueCheck }> {
  const question = await actions.findQuestion();
  if (!question || question.graded) {
    throw new TutorToolError(
      "There is no open Question to grade: ask one first.",
    );
  }
  if (question.sessionEnded) {
    throw new TutorToolError(
      "This question's study session has ended, so it can't be graded.",
    );
  }
  const close = async () => {
    if (!(await actions.closeQuestion(question.id))) {
      throw new TutorToolError(alreadyGraded);
    }
    return { kcs: [], check: null };
  };
  if (input.noAnswer) return close();
  if (!question.answered) {
    throw new TutorToolError(
      "The Student has not answered this question yet: wait for their answer.",
    );
  }
  if (!input.results || !input.help) {
    throw new TutorToolError(
      "Give results and help, or noAnswer: true when the Student moved on.",
    );
  }
  // Every KC it tested was retired since the ask: nothing to record.
  if (question.kcIds.length === 0) return close();
  const help = input.help;
  const results = input.results.filter(
    ({ kcId }) => !question.retiredKcIds.includes(kcId),
  );
  const kcIds = results.map(({ kcId }) => kcId);
  if (new Set(kcIds).size < kcIds.length) {
    throw new TutorToolError("Give each KC once.");
  }
  const foreign = kcIds.filter((id) => !question.kcIds.includes(id));
  const missing = question.kcIds.filter((id) => !kcIds.includes(id));
  if (foreign.length > 0 || missing.length > 0) {
    throw new TutorToolError(
      `Give one result for each KC the question tests, and no others: ${question.kcIds.join(", ")}.`,
    );
  }
  const keys = question.finalAnswers ?? [];
  const checked = checkAnswers(keys, input.finalValues ?? []);
  if (!checked.ok) throw new TutorToolError(checked.error);
  const unvalued = keys.filter((_, index) => checked.checks[index] === null);
  if (unvalued.length > 0 && results.some(({ result }) => result === "full")) {
    throw new TutorToolError(
      `A full needs the Student's value for each final result, for the check: give it in finalValues for ${unvalued.map(({ label }) => `"${label}"`).join(", ")}. Without one in the answer, no KC is full.`,
    );
  }
  const check = worstCheck(checked.checks);
  const kcs = await actions.saveGrade({
    questionId: question.id,
    help,
    results: results.map(({ kcId, result }) => ({
      kcId,
      result: check === "mismatch" && result === "full" ? "partial" : result,
    })),
    check,
  });
  if (!kcs) throw new TutorToolError(alreadyGraded);
  return { kcs, check };
}

export type TutorTools = ReturnType<typeof tutorTools>;

/**
 * Ends a reply at a call that waits for the Student: a question (`ask`) or
 * a reading (`showReading`).
 */
export const endsReply = hasToolCall("ask", "showReading");
