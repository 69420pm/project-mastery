import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { GoldCourse } from "./gold-course";

/**
 * A tutoring scenario (`evals/tutor/scenarios/*.md`): its setup, a JSON
 * block under "## Setup", and the rows that setup stores for a Student of
 * the gold course before the first message. KCs, Topics and Exercises are
 * named as in the gold course, since every seed gives them new ids.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** KCs by name, and every KC of the Topics named. */
const kcRefs = {
  kcs: z.array(z.string()).default([]),
  topics: z.array(z.string()).default([]),
};

const result = z.enum(["full", "partial", "wrong"]);
const help = z.enum(["none", "some", "solution_shown"]);

export const setupSchema = z
  .object({
    /** Days from today to the exam. */
    examInDays: z.number().int().min(0).default(42),
    goal: z.enum(["pass", "good_grade", "master_everything"]).optional(),
    /** The Memory's lines, dated `daysAgo`. */
    memory: z
      .array(z.object({ daysAgo: z.number().min(0), text: z.string() }))
      .default([]),
    /**
     * Attempts that already exist: each entry one earlier session `daysAgo`
     * with one graded Question on its KCs.
     */
    attempts: z
      .array(
        z.object({
          ...kcRefs,
          daysAgo: z.number().min(0),
          result: result.default("full"),
          help: help.default("none"),
        }),
      )
      .default([]),
    /**
     * A Question the AI asked in this Chat, not answered yet: the Student's
     * opening message, the AI's lead-in and its `ask`. An Exercise, named by
     * a unique piece of its text, gives its KCs and statement by default.
     */
    openQuestion: z
      .object({
        ...kcRefs,
        opening: z.string().default("Let's start studying."),
        leadIn: z.string(),
        prompt: z.string().optional(),
        exercise: z.string().optional(),
      })
      .optional(),
    /**
     * A graded Mock exam `daysAgo`, its items Exercises named by a unique
     * piece of their text. With `review`, this Chat goes through it, as the
     * mock page's "Go through it with the tutor" link does.
     */
    mock: z
      .object({
        daysAgo: z.number().min(0),
        review: z.boolean().default(true),
        items: z
          .array(
            z.object({
              exercise: z.string(),
              points: z.number().int().positive(),
              awarded: z.number().min(0),
              answer: z.string(),
              reasons: z
                .array(z.object({ points: z.number(), reason: z.string() }))
                .default([]),
            }),
          )
          .min(1),
      })
      .optional(),
  })
  .strict();

export type ScenarioSetup = z.infer<typeof setupSchema>;

/** The setup of a scenario file: the JSON block under "## Setup". */
export function parseScenario(markdown: string): ScenarioSetup {
  const block = /^## Setup\b[\s\S]*?```json\n([\s\S]*?)\n```/m.exec(markdown);
  if (!block)
    throw new Error('A scenario needs a ```json block under "## Setup".');
  return setupSchema.parse(JSON.parse(block[1]!));
}

/** The rows a setup stores, in insert order, and what it changes. */
export type SetupPlan = {
  inserts: Array<{ table: string; rows: Array<Record<string, unknown>> }>;
  /** The Brief's goal, when the setup sets one. */
  goal: string | null;
  /** The graded mock this Chat's session goes through. */
  sessionMockId: string | null;
};

/**
 * The rows that put `setup` in place for the Student `studentId` of the
 * seeded `gold` course, whose Chat `chatId` has the running session
 * `sessionId`. Dates count back from `now`.
 */
export function setupRows(
  gold: GoldCourse,
  setup: ScenarioSetup,
  ids: { studentId: string; chatId: string; sessionId: string },
  now: Date,
  newId: () => string = randomUUID,
): SetupPlan {
  const owner = ids.studentId;
  const owned = { owner, course_id: gold.courseId };
  const at = (daysAgo: number) =>
    new Date(now.getTime() - daysAgo * DAY_MS).toISOString();
  const rows: Record<string, Array<Record<string, unknown>>> = {};
  const add = (table: string, ...items: Array<Record<string, unknown>>) => {
    (rows[table] ??= []).push(...items);
  };
  const kcsOf = (refs: { kcs: string[]; topics: string[] }) =>
    resolveKcs(gold, refs);

  /** A graded Question with one Attempt per KC. */
  const gradedQuestion = (
    question: { sessionId: string; prompt: string; time: string },
    attempts: Array<{ kcId: string; result: string; help: string }>,
    extra: Record<string, unknown> = {},
  ) => {
    const id = newId();
    add("questions", {
      id,
      owner,
      session_id: question.sessionId,
      prompt: question.prompt,
      asked_at: question.time,
      answered_at: question.time,
      graded_at: question.time,
      ...extra,
    });
    add(
      "question_kcs",
      ...attempts.map(({ kcId }) => ({ question_id: id, kc_id: kcId })),
    );
    add(
      "attempts",
      ...attempts.map((attempt) => ({
        owner,
        question_id: id,
        session_id: question.sessionId,
        kc_id: attempt.kcId,
        result: attempt.result,
        help: attempt.help,
        created_at: question.time,
      })),
    );
    return id;
  };

  for (const entry of setup.attempts) {
    const time = at(entry.daysAgo);
    const kcIds = kcsOf(entry);
    const sessionId = newId();
    add("study_sessions", {
      ...owned,
      id: sessionId,
      started_at: time,
      ended_at: time,
    });
    const names = kcIds.map((id) => gold.kcs.find((kc) => kc.id === id)!.name);
    gradedQuestion(
      { sessionId, prompt: `Explain ${names.join(", ")}.`, time },
      kcIds.map((kcId) => ({ kcId, result: entry.result, help: entry.help })),
      { answer_text: "An answer from an earlier session." },
    );
  }

  let sessionMockId: string | null = null;
  if (setup.mock) {
    const time = at(setup.mock.daysAgo);
    const sessionId = newId();
    const mockId = newId();
    add("study_sessions", {
      ...owned,
      id: sessionId,
      started_at: time,
      ended_at: time,
    });
    const items = setup.mock.items.map((item, position) => {
      const exercise = findExercise(gold, item.exercise);
      const share = item.awarded / item.points;
      const itemResult =
        share >= 1 ? "full" : share === 0 ? "wrong" : "partial";
      const questionId = gradedQuestion(
        { sessionId, prompt: exercise.markdown, time },
        exercise.kcs.map((kcId) => ({
          kcId,
          result: itemResult,
          help: "none",
        })),
        { answer_text: item.answer, exercise_id: exercise.id },
      );
      return {
        owner,
        mock_id: mockId,
        position,
        exercise_id: exercise.id,
        prompt: exercise.markdown,
        points: item.points,
        points_awarded: item.awarded,
        predicted_success: 0.5,
        question_id: questionId,
        steps: item.reasons,
        graded_at: time,
      };
    });
    add("mock_exams", {
      ...owned,
      id: mockId,
      status: "graded",
      duration_minutes: 90,
      session_id: sessionId,
      started_at: time,
      submitted_at: time,
      grading_started_at: time,
      graded_at: time,
      score: setup.mock.items.reduce((sum, item) => sum + item.awarded, 0),
    });
    add("mock_items", ...items);
    if (setup.mock.review) sessionMockId = mockId;
  }

  if (setup.memory.length > 0) {
    add("memories", {
      ...owned,
      text: setup.memory
        .map(({ daysAgo, text }) => `${at(daysAgo).slice(0, 10)}: ${text}`)
        .join("\n"),
    });
  }

  const open = setup.openQuestion;
  if (open) {
    const exercise = open.exercise ? findExercise(gold, open.exercise) : null;
    const named = kcsOf(open);
    const kcIds = named.length > 0 ? named : (exercise?.kcs ?? []);
    if (kcIds.length === 0) {
      throw new Error("The open Question needs KCs, Topics or an Exercise.");
    }
    const prompt = open.prompt ?? exercise?.markdown;
    if (!prompt) throw new Error("The open Question needs a prompt.");
    const time = now.toISOString();
    const questionId = newId();
    add("questions", {
      id: questionId,
      owner,
      session_id: ids.sessionId,
      prompt,
      asked_at: time,
      exercise_id: exercise?.id ?? null,
    });
    add(
      "question_kcs",
      ...kcIds.map((kcId) => ({ question_id: questionId, kc_id: kcId })),
    );
    // The Chat so far: the Student's opening and the reply that asked.
    add(
      "chat_messages",
      {
        id: newId(),
        chat_id: ids.chatId,
        role: "user",
        parts: [{ type: "text", text: open.opening }],
        created_at: time,
      },
      {
        id: newId(),
        chat_id: ids.chatId,
        role: "assistant",
        // An AI message names its model; this one the setup wrote.
        model_id: "scenario-setup",
        parts: [
          { type: "step-start" },
          { type: "text", text: open.leadIn, state: "done" },
          {
            type: "tool-ask",
            toolCallId: `setup-${questionId}`,
            state: "output-available",
            input: {
              prompt,
              kcIds,
              ...(exercise ? { problemId: exercise.id } : {}),
            },
            output: { questionId },
          },
        ],
        created_at: new Date(now.getTime() + 1).toISOString(),
      },
    );
  }

  // Parents before children, so every foreign key finds its row.
  const order = [
    "study_sessions",
    "questions",
    "question_kcs",
    "attempts",
    "mock_exams",
    "mock_items",
    "memories",
    "chat_messages",
  ];
  return {
    inserts: order
      .filter((table) => rows[table])
      .map((table) => ({ table, rows: rows[table]! })),
    goal: setup.goal ?? null,
    sessionMockId,
  };
}

/** The ids of the KCs named, then of every KC of the Topics named. */
function resolveKcs(
  gold: GoldCourse,
  refs: { kcs: string[]; topics: string[] },
): string[] {
  const ids = refs.kcs.map((name) => {
    const kc = gold.kcs.find((k) => k.name === name);
    if (!kc) throw new Error(`No KC named "${name}" in the gold course.`);
    return kc.id;
  });
  for (const name of refs.topics) {
    const topic = gold.topics.find((t) => t.name === name);
    if (!topic) throw new Error(`No Topic named "${name}" in the gold course.`);
    ids.push(...topic.kcs);
  }
  return [...new Set(ids)];
}

/** The one askable Exercise whose text contains `text`. */
function findExercise(gold: GoldCourse, text: string) {
  const found = gold.exercises.filter((e) => e.markdown.includes(text));
  if (found.length !== 1) {
    throw new Error(
      `"${text}" names ${found.length} Exercises of the gold course; give a piece of text only one holds.`,
    );
  }
  const exercise = found[0]!;
  if (exercise.reserved) {
    throw new Error(
      `"${text}" is in the Reserved exam, which the AI never sees.`,
    );
  }
  return exercise;
}
