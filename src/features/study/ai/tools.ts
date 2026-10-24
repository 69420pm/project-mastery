import { tool } from "ai";
import { z } from "zod";
import type { FinalAnswer } from "@/features/knowledge-map";
import {
  checkFinalValue,
  parseFinalValue,
} from "@/features/study/domain/final-answers";
import type {
  ExerciseView,
  GradedKc,
  KcReading,
  QuestionKind,
} from "@/features/study/types";

/** What `readKcs` and `findExercises` take: KC ids of the Course. */
const kcIdsInputSchema = z.object({
  kcIds: z
    .array(z.string())
    .min(1)
    .max(8)
    .describe("The ids of 1 to 8 KCs of this Course."),
});

const QUESTION_KINDS = [
  "prequestion",
  "recall",
  "question",
  "problem",
  "rebuild",
  "mock_item",
] as const satisfies readonly QuestionKind[];

/** What `ask` takes: one graded question for a question card. */
const askInputSchema = z.object({
  kind: z
    .enum(QUESTION_KINDS)
    .describe(
      "prequestion: before teaching, a guess on what comes next; recall: retrieve what was taught; question: check understanding; problem: a problem or Exercise to solve; rebuild: rebuild a derivation or argument; mock_item: an exam-conditions item.",
    ),
  prompt: z
    .string()
    .min(1)
    .max(20_000)
    .describe(
      "The question as the Student reads it on the card, in Markdown with LaTeX. Complete on its own: give all data the Student needs.",
    ),
  kcIds: kcIdsInputSchema.shape.kcIds.describe(
    "The ids of the 1 to 8 KCs of this Course the question tests.",
  ),
  exerciseId: z
    .string()
    .nullish()
    .describe(
      "The id of the Exercise from findExercises when the question poses one; omit it for your own question.",
    ),
});

/** What `grade` takes: the verdict on the Student's answer to a question. */
const gradeInputSchema = z.object({
  questionId: z
    .string()
    .describe("The questionId that ask returned for the question answered."),
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
    .max(8)
    .describe("One result for each of the question's KCs, each KC once."),
  help: z
    .enum(["none", "some", "solution_shown"])
    .describe(
      "How much you helped on this question before the answer: none, some (hints or corrections), or solution_shown when you showed or walked through the solution.",
    ),
  finalValue: z
    .string()
    .max(100)
    .nullish()
    .describe(
      'For a question that poses an Exercise with a numeric result: the Student\'s final value with its unit, as a number and a unit such as "17.5 kN", "1.2e5 Pa" or "9.81 m/s^2". Omit it when the Student gave no final number.',
    ),
});

type GradeInput = z.infer<typeof gradeInputSchema>;

/** A stored question as `grade` checks it. */
export type QuestionToGrade = {
  kind: QuestionKind;
  /** The KCs it tests. */
  kcIds: string[];
  answered: boolean;
  graded: boolean;
  /** Its Exercise's numeric final answers; null without any. */
  finalAnswers: FinalAnswer[] | null;
};

/** What the numeric check found: null when it didn't apply. */
export type FinalValueCheck = "match" | "mismatch" | null;

/** What `remember` takes: one line for the Memory. */
const rememberInputSchema = z.object({
  text: z
    .string()
    .min(1)
    .max(300)
    .regex(/^[^\r\n]+$/, "One line, without line breaks.")
    .describe("One line of at most 300 characters, without line breaks."),
});

/**
 * What the tools do. A refusal, such as an id that is no KC of the Course,
 * throws a `TutorToolError`, whose message the model sees.
 */
export type TutorToolActions = {
  readKcs: (kcIds: string[]) => Promise<KcReading[]>;
  /** A note, without Exercises, tells the model why there are none. */
  findExercises: (
    kcIds: string[],
  ) => Promise<{ exercises: ExerciseView[]; note?: string }>;
  /** Appends one line to the Course's Memory. */
  remember: (text: string) => Promise<void>;
  /** Stores a question in the Chat's Study session; returns its id. */
  ask: (question: {
    kind: QuestionKind;
    prompt: string;
    kcIds: string[];
    exerciseId: string | null;
  }) => Promise<string>;
  /** A question asked in the Chat's Study session; null for any other id. */
  findQuestion: (questionId: string) => Promise<QuestionToGrade | null>;
  /**
   * Marks the question graded and stores one attempt per KC; returns each
   * KC's new state, or null when it was graded in the meantime.
   */
  saveGrade: (grade: {
    questionId: string;
    kind: "pre" | "learn";
    help: GradeInput["help"];
    results: GradeInput["results"];
    check: FinalValueCheck;
  }) => Promise<GradedKc[] | null>;
};

/** A refused tool call: its message tells the model what to fix. */
export class TutorToolError extends Error {
  override name = "TutorToolError";
}

/** The tools the AI tutors with in a Chat. */
export function tutorTools(actions: TutorToolActions) {
  return {
    readKcs: tool({
      description:
        "Read KCs of this Course before teaching them: each KC's name, type and description, and up to 3 source chunks from the Course's Materials in reading order, each with its Markdown, Material, pages and a link to cite.",
      inputSchema: kcIdsInputSchema,
      execute: async ({ kcIds }) => ({ kcs: await actions.readKcs(kcIds) }),
    }),
    findExercises: tool({
      description:
        "Find up to 3 Exercises of this Course that test any of the given KCs and that the Student has not attempted yet, old-exam ones first. Each comes with its question, the KCs it tests, a link to cite and its solution, labelled with its status. Use it for the apply step; never show the solution before the Student has tried. A disputed solution may be wrong: check it yourself before relying on it.",
      inputSchema: kcIdsInputSchema,
      execute: async ({ kcIds }) => actions.findExercises(kcIds),
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
        "Ask the Student a graded question: it shows on a question card where they answer, and ends your reply. Write any lead-in before calling it, and don't repeat the question in your text. Returns the questionId to grade the answer with.",
      inputSchema: askInputSchema,
      execute: async ({ exerciseId, ...question }) => ({
        questionId: await actions.ask({
          ...question,
          exerciseId: exerciseId ?? null,
        }),
      }),
    }),
    grade: tool({
      description:
        "Grade the Student's answer to a question you asked with ask, before you give feedback: a result for each of its KCs, how much you helped and, for an Exercise with a numeric result, the Student's final value. Code checks that value against the Exercise's key at 1% tolerance: on a mismatch every full becomes partial. Returns each KC's result, its state (new, learning, due or known), its next review date (YYYY-MM-DD) and recall today (0 to 1), and the check: match, mismatch or null when it didn't apply. A KC first taught in this session is learning with no next review or recall until the session ends.",
      inputSchema: gradeInputSchema,
      execute: async (input) => grade(actions, input),
    }),
  };
}

const alreadyGraded = "This question is already graded.";

/**
 * The `grade` call's rules: one result for each KC of an open, answered
 * question, and the numeric check of a final value against its Exercise's
 * final answers, which turns every `full` into `partial` on a mismatch.
 */
async function grade(
  actions: TutorToolActions,
  input: GradeInput,
): Promise<{ kcs: GradedKc[]; check: FinalValueCheck }> {
  const question = await actions.findQuestion(input.questionId);
  if (!question) {
    throw new TutorToolError(
      `${input.questionId} is no question you asked in this Chat: use the questionId that ask returned.`,
    );
  }
  if (question.graded) throw new TutorToolError(alreadyGraded);
  if (!question.answered) {
    throw new TutorToolError(
      "The Student has not answered this question yet: wait for their answer on the card.",
    );
  }
  const kcIds = input.results.map(({ kcId }) => kcId);
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
  const check = checkAgainstKey(question.finalAnswers, input.finalValue);
  const kcs = await actions.saveGrade({
    questionId: input.questionId,
    kind: question.kind === "prequestion" ? "pre" : "learn",
    help: input.help,
    results: input.results.map(({ kcId, result }) => ({
      kcId,
      result: check === "mismatch" && result === "full" ? "partial" : result,
    })),
    check,
  });
  if (!kcs) throw new TutorToolError(alreadyGraded);
  return { kcs, check };
}

/** The numeric check, when the question has a key and a value was given. */
function checkAgainstKey(
  keys: FinalAnswer[] | null,
  finalValue: string | null | undefined,
): FinalValueCheck {
  if (!keys || keys.length === 0 || !finalValue) return null;
  const value = parseFinalValue(finalValue);
  if (value === null) {
    throw new TutorToolError(
      `finalValue "${finalValue}" is no number with a unit: give it like "17.5 kN" or "0.508", or omit it.`,
    );
  }
  return checkFinalValue(value, keys);
}

export type TutorTools = ReturnType<typeof tutorTools>;
