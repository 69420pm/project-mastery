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
import { computeTool } from "@/features/study/ai/compute-tool";
import type { ProgramRun } from "@/features/study/server/math-runner";
import type {
  ProblemView,
  GradedKc,
  MapFindingKind,
  QuestionKind,
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
  problemId: z
    .string()
    .nullish()
    .describe(
      "The id of the Problem from findProblems when the question poses one; omit it for your own question.",
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
  /** Its Exercise's or generated Problem's numeric final answers; null without any. */
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

/** What `searchMaterials` takes: one line to search the Course by meaning. */
const searchMaterialsInputSchema = z.object({
  query: rememberInputSchema.shape.text.describe(
    "What to look for, in one line of at most 300 characters, as a question or a phrase from the Materials.",
  ),
});

const MAP_FINDING_KINDS = [
  "missing_link",
  "wrong_link",
  "wrong_description",
] as const satisfies readonly MapFindingKind[];

/** What `flagMap` takes: a map Finding with the quote that shows it. */
const flagMapInputSchema = z.object({
  kind: z
    .enum(MAP_FINDING_KINDS)
    .describe(
      "missing_link: the sources show one KC builds on the other, and the map doesn't link them; wrong_link: the map links them and the sources contradict it; wrong_description: the sources contradict the KC's description.",
    ),
  kcId: z
    .string()
    .describe(
      "The id of the KC of this Course the Finding is about: for a link, the one that builds on the other.",
    ),
  linkedKcId: z
    .string()
    .nullish()
    .describe(
      "For a link kind, the id of kcId's prerequisite; omit it for wrong_description.",
    ),
  chunkId: z
    .string()
    .describe(
      "The chunkId of the source chunk that shows it, from getTopic or searchMaterials.",
    ),
  quote: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "The words of that chunk's Markdown that show it, copied exactly: at most 500 characters.",
    ),
  reason: rememberInputSchema.shape.text.describe(
    "What is wrong with the map and what the sources say, in one line of at most 300 characters.",
  ),
});

type FlagMapInput = z.infer<typeof flagMapInputSchema>;

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
  /** Whether the id is a KC of the Course. */
  isKc: (kcId: string) => boolean;
  /** A chunk of the Course; null for any other id. */
  findChunk: (chunkId: string) => Promise<{ markdown: string } | null>;
  /** Stores an open map Finding in the Chat's Study session; returns its id. */
  saveMapFinding: (finding: {
    kind: MapFindingKind;
    kcId: string;
    linkedKcId: string | null;
    chunkId: string;
    quote: string;
    reason: string;
  }) => Promise<string>;
  /** A note, without Problems, tells the model why there are none. */
  findProblems: (
    kcIds: string[],
  ) => Promise<{ problems: ProblemView[]; note?: string }>;
  /** A Reading section of the Course; null for any other id. */
  findReading: (sectionId: string) => Promise<ReadingToShow | null>;
  /** Appends one line to the Course's Memory. */
  remember: (text: string) => Promise<void>;
  /**
   * Stores a question in the Chat's Study session; returns its id, and the
   * generated Problem it poses, which its card lets the Student flag.
   */
  ask: (question: {
    kind: QuestionKind;
    prompt: string;
    kcIds: string[];
    problemId: string | null;
  }) => Promise<{ questionId: string; generatedProblemId: string | null }>;
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
        "Read a Topic of this Course before teaching it: its central question, its KCs in order with their type, description and state (new, learning, due or known), its anchors with their state and its Reading sections, each marked done when the Student has read it. The KCs you give in kcIds (all of the Topic's when omitted) come with up to 3 source chunks from the Course's Materials in reading order, each with its Markdown, Material, pages and a link to cite. Each KC lists its open and accepted map Findings (kind, the other KC and the reason): where it has one, the map may be wrong, so lean on the sources. Without a topicId, it reads the KCs in kcIds alone, with their type, description, state and source chunks.",
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
            `${topicId} is no Topic id of this Course: use the id of the next Topic, or of a due review's Topic.`,
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
    flagMap: tool({
      description:
        "File a Finding on the Knowledge map when the course's sources show it is wrong: a link between two KCs it lacks, a link the sources contradict, or a KC's description the sources contradict. Check the sources first with getTopic or searchMaterials, and quote the chunk that shows it. The Student accepts or dismisses it on the Course map, and the next Update map applies the accepted ones; nothing changes before. Never file one for what is only plausible from general knowledge. Returns the Finding's id.",
      inputSchema: flagMapInputSchema,
      execute: async (input) => flagMap(actions, input),
    }),
    findProblems: tool({
      description:
        "Find up to 3 Problems for the given KCs that test any of them and that the Student has not attempted yet: Exercises of this Course first, then Problems generated for it, ranked to vary and step up in difficulty. Each comes with its source (old_exam, exercise, or a generated variant of an Exercise or new Problem), its question, the KCs it tests, a link to cite (null for a generated Problem) and its solution, labelled with where it comes from. Use it for the apply step, and pose the Problem you pick through ask with its problemId, never as text; never show the solution before the Student has tried. A generated solution without a program may be wrong: check it yourself before relying on it.",
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
        "Ask the Student a graded question: it shows on a question card where they answer, and ends your reply. Write any lead-in before calling it, and don't repeat the question in your text. Returns the questionId to grade the answer with.",
      inputSchema: askInputSchema,
      execute: async ({ problemId, ...question }) => {
        const { questionId, generatedProblemId } = await actions.ask({
          ...question,
          problemId: problemId ?? null,
        });
        return generatedProblemId === null
          ? { questionId }
          : { questionId, generatedProblemId };
      },
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
    compute: computeTool(actions.compute),
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

/** Lower case with whitespace collapsed, as `flagMap` compares quotes. */
const normalized = (text: string) =>
  text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The `flagMap` call's rules: a linked KC for link kinds only, KCs and a
 * chunk of the Course, and a quote found in the chunk's Markdown.
 */
async function flagMap(
  actions: TutorToolActions,
  { linkedKcId, ...input }: FlagMapInput,
): Promise<{ findingId: string }> {
  const linked = linkedKcId || null;
  if (input.kind === "wrong_description" && linked) {
    throw new TutorToolError(
      "A wrong_description Finding is about one KC: omit linkedKcId.",
    );
  }
  if (input.kind !== "wrong_description" && !linked) {
    throw new TutorToolError(
      `A ${input.kind} Finding links two KCs: give the prerequisite of kcId as linkedKcId.`,
    );
  }
  if (linked === input.kcId) {
    throw new TutorToolError("A link joins two different KCs.");
  }
  const unknown = [input.kcId, linked].filter(
    (id): id is string => id !== null && !actions.isKc(id),
  );
  if (unknown.length > 0) {
    throw new TutorToolError(
      `These are no KC ids of this Course: ${unknown.join(", ")}. Use the ids getTopic returns.`,
    );
  }
  const chunk = await actions.findChunk(input.chunkId);
  if (!chunk) {
    throw new TutorToolError(
      `${input.chunkId} is no chunk of this Course: use a chunkId from getTopic or searchMaterials.`,
    );
  }
  const quote = normalized(input.quote);
  if (quote === "") {
    throw new TutorToolError(
      "The quote is empty: copy the words that show it from the chunk.",
    );
  }
  if (!normalized(chunk.markdown).includes(quote)) {
    throw new TutorToolError(
      "The quote is not in that chunk's Markdown: copy its words exactly from the chunk.",
    );
  }
  const findingId = await actions.saveMapFinding({
    ...input,
    linkedKcId: linked,
  });
  return { findingId };
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
