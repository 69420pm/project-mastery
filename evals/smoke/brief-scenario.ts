import { z } from "zod";

/**
 * A Brief scenario (`evals/brief/scenarios/*.md`): its setup, an optional
 * JSON block under "## Setup", and the Brief that setup stores for a
 * Student before the first message. Without a setup the Brief is new: no
 * answers, and the Course's likely old exams proposed but not asked.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const setupSchema = z
  .object({
    /**
     * A Brief the Student already went through: these answers stored, the
     * scope confirmed, every proposed old exam confirmed and the reserved
     * exam answered with none kept.
     */
    answered: z
      .object({
        /** Days from today to the exam. */
        examInDays: z.number().int().min(0),
        goal: z.enum(["pass", "good_grade", "master_everything"]),
        openBook: z.boolean(),
        formulaSheet: z.boolean(),
        calculator: z.boolean(),
        notes: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type BriefSetup = z.infer<typeof setupSchema>;

/** The setup of a scenario file: the JSON block under "## Setup", if any. */
export function parseScenario(markdown: string): BriefSetup {
  const section = /^## Setup\b[\s\S]*?(?=^## |(?![\s\S]))/m.exec(markdown);
  if (!section) return setupSchema.parse({});
  const block = /```json\n([\s\S]*?)\n```/.exec(section[0]);
  if (!block) {
    throw new Error('A "## Setup" section needs a ```json block.');
  }
  return setupSchema.parse(JSON.parse(block[1]!));
}

/** What a setup stores: the Brief's row, and its old exams' marks. */
export type BriefPlan = {
  /** The `briefs` row, inserted in place of the Course's own. */
  brief: Record<string, unknown>;
  /** The Chapters the parse proposed as old exams, and their answer. */
  examChapters: { ids: string[]; isExam: boolean | null; asked: boolean };
};

/**
 * The Brief that puts `setup` in place in the Course `courseId` of
 * `studentId`, whose likely old exams are the Chapters `examChapterIds`.
 * The exam date counts from `now`.
 */
export function briefSetup(
  course: { courseId: string; studentId: string; examChapterIds: string[] },
  setup: BriefSetup,
  now: Date,
): BriefPlan {
  const row = {
    course_id: course.courseId,
    owner: course.studentId,
    reserved_exam_chapter_id: null,
  };
  const ids = course.examChapterIds;
  const done = setup.answered;
  if (!done) {
    return {
      brief: {
        ...row,
        exam_date: null,
        goal: null,
        open_book: null,
        formula_sheet: null,
        calculator: null,
        scope_confirmed: false,
        notes: null,
        reserved_exam_answered: false,
      },
      examChapters: { ids, isExam: null, asked: false },
    };
  }
  return {
    brief: {
      ...row,
      exam_date: new Date(now.getTime() + done.examInDays * DAY_MS)
        .toISOString()
        .slice(0, 10),
      goal: done.goal,
      open_book: done.openBook,
      formula_sheet: done.formulaSheet,
      calculator: done.calculator,
      scope_confirmed: true,
      notes: done.notes ?? null,
      reserved_exam_answered: ids.length > 0,
    },
    examChapters: { ids, isExam: true, asked: true },
  };
}
