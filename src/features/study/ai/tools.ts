import { hasToolCall, tool } from "ai";
import { z } from "zod";
import type { FinalAnswer } from "@/features/knowledge-map";
import {
  checkFinalValue,
  parseFinalValue,
} from "@/features/study/domain/final-answers";
import {
  STAGES,
  stageMoveRefusal,
  type Stage,
} from "@/features/study/domain/stages";
import type {
  ExerciseView,
  GradedKc,
  QuestionKind,
  ReadingView,
  TopicView,
} from "@/features/study/types";

/** What `findExercises` takes: KC ids of the Course. */
const kcIdsInputSchema = z.object({
  kcIds: z
    .array(z.string())
    .min(1)
    .max(8)
    .describe("The ids of 1 to 8 KCs of this Course."),
});

/** The most KCs one question tests, as many as a Topic has at most. */
const MAX_QUESTION_KCS = 12;

/** What `getTopic` takes: a Topic and, for source chunks, some of its KCs. */
const getTopicInputSchema = z.object({
  topicId: z.string().describe("The id of a Topic of this Course."),
  kcIds: z
    .array(z.string())
    .min(1)
    .max(MAX_QUESTION_KCS)
    .nullish()
    .describe(
      "The ids of KCs of this Topic to read the source chunks of; omit it for every KC of the Topic.",
    ),
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
  kcIds: z
    .array(z.string())
    .min(1)
    .max(MAX_QUESTION_KCS)
    .describe("The ids of the 1 to 12 KCs of this Course the question tests."),
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
    .max(MAX_QUESTION_KCS)
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
  /** Whether its Study session has ended, which closes it for grading. */
  sessionEnded: boolean;
  /** Its Exercise's numeric final answers; null without any. */
  finalAnswers: FinalAnswer[] | null;
};

/** A stored Reading section as `showReading` reads it. */
export type ReadingToShow = Omit<ReadingView, "studyText"> & {
  studyText: string | null;
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

/** What `showReading` takes: a Reading section and why the Student reads it. */
const showReadingInputSchema = z.object({
  sectionId: z
    .string()
    .describe("The id of a Reading section listed for the next Topic."),
  purpose: rememberInputSchema.shape.text.describe(
    "The question the reading answers, which the Student reads it for: one line of at most 300 characters.",
  ),
});

/** What `setStage` takes: the stage to move to and, to skip, why. */
const setStageInputSchema = z.object({
  stage: z.enum(STAGES).describe("The stage of this learn session to move to."),
  reason: rememberInputSchema.shape.text
    .nullish()
    .describe(
      "Why, in one line, when you skip a stage: needed for any move but the next stage, work back to read for a Reading section left, and review to the stage named for after it.",
    ),
});

/** Where a learn session stands, as `setStage` checks a move against it. */
export type SessionStage = {
  stage: Stage;
  /** Where the session goes after `review`. */
  afterReview: Stage;
  /** Whether a Reading section of the Topic has no Done message yet. */
  readingLeft: boolean;
};

/**
 * What the tools do. A refusal, such as an id that is no KC of the Course,
 * throws a `TutorToolError`, whose message the model sees.
 */
export type TutorToolActions = {
  /** The Chat's learn session's stage; null when it has no Topic. */
  loadStage: () => Promise<SessionStage | null>;
  /** Moves the session to a stage; false when it has ended or is at close. */
  saveStage: (stage: Stage) => Promise<boolean>;
  /**
   * A Topic of the Course with the source chunks of `kcIds`, or of all its
   * KCs when none; null for an id that is no Topic of the Course. Throws a
   * `TutorToolError` for a KC that is not of the Topic.
   */
  getTopic: (topicId: string, kcIds?: string[]) => Promise<TopicView | null>;
  /** A note, without Exercises, tells the model why there are none. */
  findExercises: (
    kcIds: string[],
  ) => Promise<{ exercises: ExerciseView[]; note?: string }>;
  /** A Reading section of the Course; null for any other id. */
  findReading: (sectionId: string) => Promise<ReadingToShow | null>;
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
    getTopic: tool({
      description:
        "Read a Topic of this Course before teaching it: its central question, its KCs in order with their type, description and state (new, learning, due or known), its anchors with their state and its Reading sections, each marked done when the Student has read it. The KCs you give in kcIds (all of the Topic's when omitted) come with up to 3 source chunks from the Course's Materials in reading order, each with its Markdown, Material, pages and a link to cite.",
      inputSchema: getTopicInputSchema,
      execute: async ({ topicId, kcIds }) => {
        const topic = await actions.getTopic(topicId, kcIds ?? undefined);
        if (!topic) {
          throw new TutorToolError(
            `${topicId} is no Topic id of this Course: use the id of the next Topic, or of a due review's Topic.`,
          );
        }
        return topic;
      },
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
    showReading: tool({
      description:
        "Open a Reading section of the course's pages for the Student to read, with the question they read it for: it shows on a reading card, opens the pages beside the Chat and ends your reply. Write a short lead-in first, and don't repeat the question in your text. Returns the section's label, its mode, its chunks' Markdown in order and, in study_text mode, the study text the Student reads, so you can ask about what they read.",
      inputSchema: showReadingInputSchema,
      execute: async ({ sectionId }) => showReading(actions, sectionId),
    }),
    setStage: tool({
      description:
        "Move this learn session to another stage once the current one has done its job. Without a reason it allows the next stage in order, work back to read while a Reading section of the Topic is left, and review to the stage named for after it; any other forward move needs a one-line reason. It never moves back otherwise, and close is final. Returns the stage the session is at.",
      inputSchema: setStageInputSchema,
      execute: async (input) => setStage(actions, input),
    }),
    grade: tool({
      description:
        "Grade the Student's answer to a question you asked with ask, before you give feedback: a result for each of its KCs, how much you helped and, for an Exercise with a numeric result, the Student's final value. Code checks that value against the Exercise's key at 1% tolerance: on a mismatch every full becomes partial. Returns each KC's result, its state (new, learning, due or known), its next review date (YYYY-MM-DD) and recall today (0 to 1), and the check: match, mismatch or null when it didn't apply. A KC first taught in this session is learning with no next review or recall until the session ends.",
      inputSchema: gradeInputSchema,
      execute: async (input) => grade(actions, input),
    }),
  };
}

/**
 * The `showReading` call: a Reading section of the Course, with its study
 * text only when the Student reads that.
 */
async function showReading(
  actions: TutorToolActions,
  sectionId: string,
): Promise<ReadingView> {
  const section = await actions.findReading(sectionId);
  if (!section) {
    throw new TutorToolError(
      `${sectionId} is no Reading section of this Course: use a section id listed for the next Topic.`,
    );
  }
  const { studyText, ...reading } = section;
  return reading.mode === "study_text" && studyText !== null
    ? { ...reading, studyText }
    : reading;
}

/** The `setStage` call: a move `stageMoveRefusal` allows, then saved. */
async function setStage(
  actions: TutorToolActions,
  { stage, reason }: z.infer<typeof setStageInputSchema>,
): Promise<{ stage: Stage }> {
  const session = await actions.loadStage();
  if (!session) {
    throw new TutorToolError(
      "This session has no Topic, so it has no stages: tutor without them.",
    );
  }
  const refusal = stageMoveRefusal({
    ...session,
    from: session.stage,
    to: stage,
    reason,
  });
  if (refusal) throw new TutorToolError(refusal);
  if (stage !== session.stage && !(await actions.saveStage(stage))) {
    throw new TutorToolError(
      "This session has ended or is at close, so its stage stays.",
    );
  }
  return { stage };
}

const alreadyGraded = "This question is already graded.";

/**
 * The `grade` call's rules: one result for each KC of an ungraded, answered
 * question of a running session, and the numeric check of a final value against its Exercise's
 * final answers, which turns every `full` into `partial` on a mismatch. A
 * `full` on a question with a key needs the final value, so the check runs.
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
  if (question.sessionEnded) {
    throw new TutorToolError(
      "This question's study session has ended, so it can't be graded.",
    );
  }
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
  if (
    question.finalAnswers?.length &&
    !input.finalValue &&
    input.results.some(({ result }) => result === "full")
  ) {
    throw new TutorToolError(
      "This question poses an Exercise with a numeric result, so a full needs the Student's final value: give it as finalValue for the check. Without a final number in the answer, no KC is full.",
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

/**
 * Ends a reply at a call that waits for the Student: a question on its card
 * (`ask`) or a reading (`showReading`).
 */
export const endsReply = hasToolCall("ask", "showReading");
