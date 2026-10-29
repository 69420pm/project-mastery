import { tool } from "ai";
import { z } from "zod";
import { MAX_BRIEF_NOTES_LENGTH } from "@/features/brief/domain/intake";

// The models may send null for a field they leave out, so null means "not
// given" as undefined does. An answer is changed, never cleared.

/** What `saveBrief` takes: the fields the Student answered, all optional. */
export const saveBriefInputSchema = z.object({
  examDate: z.iso.date().nullish().describe("The exam's date as YYYY-MM-DD."),
  goal: z
    .enum(["pass", "good_grade", "master_everything"])
    .nullish()
    .describe("What the Student wants from the exam."),
  hoursPerWeek: z
    .number()
    .positive()
    .max(80)
    .nullish()
    .describe("Hours per week the Student can study for it."),
  questionStyle: z
    .enum(["written", "multiple_choice", "mixed"])
    .nullish()
    .describe("The format of the exam's questions."),
  openBook: z.boolean().nullish().describe("Whether the exam is open book."),
  formulaSheet: z
    .boolean()
    .nullish()
    .describe("Whether a formula sheet is allowed."),
  calculator: z
    .boolean()
    .nullish()
    .describe("Whether a calculator is allowed."),
  excludedMaterialIds: z
    .array(z.string())
    .nullish()
    .describe(
      "The ids of every Material the exam does not cover. Replaces the stored set; [] includes all.",
    ),
  examMaterialIds: z
    .array(z.string())
    .nullish()
    .describe(
      "The ids of every Material that is an old exam, as the Student said. Replaces the stored set; [] when none is.",
    ),
  scopeConfirmed: z
    .boolean()
    .nullish()
    .describe(
      "True once the Student has answered the scope step: which Materials the exam covers, which are old exams, and whether the exam leaves out or stresses a Big idea or Topic.",
    ),
  reservedExamMaterialId: z
    .string()
    .nullish()
    .describe(
      'The id of the old exam the Student keeps unseen for their final Mock exam, or "none" when they keep none.',
    ),
});

export type SaveBriefInput = z.infer<typeof saveBriefInputSchema>;

/** What `addNote` takes: one statement of the Student's, verbatim. */
export const addNoteInputSchema = z.object({
  text: z
    .string()
    .min(1)
    .max(MAX_BRIEF_NOTES_LENGTH)
    .describe("The Student's statement, word for word as they wrote it."),
});

/**
 * What `setExamScope` takes: one Big idea or Topic, whether the exam leaves
 * it out or stresses it (null removes the scope), and the Student's words.
 */
export const setExamScopeInputSchema = z.object({
  bigIdeaId: z
    .string()
    .nullish()
    .describe("The Big idea's id; leave out when giving a Topic."),
  topicId: z
    .string()
    .nullish()
    .describe("The Topic's id; leave out when giving a Big idea."),
  scope: z
    .enum(["excluded", "emphasized"])
    .nullable()
    .describe(
      "excluded when the exam leaves it out, emphasized when it stresses it, null to remove the stored scope.",
    ),
  words: z
    .string()
    .min(1)
    .max(500)
    .nullish()
    .describe(
      "The Student's confirmation, quoted word for word from their message.",
    ),
});

export type SetExamScopeInput = z.infer<typeof setExamScopeInputSchema>;

/**
 * What the tools do with the Student's answers. Each returns the message
 * the model gets back; a refusal changes nothing.
 */
export type BriefToolActions = {
  saveBrief: (input: SaveBriefInput) => Promise<string>;
  addNote: (text: string) => Promise<string>;
  setExamScope: (input: SetExamScopeInput) => Promise<string>;
};

/** The model gets this when an action throws. */
const FAILED = "Not saved: storing it failed. Nothing changed.";

async function run(action: () => Promise<string>): Promise<string> {
  try {
    return await action();
  } catch (error) {
    console.error("A Brief tool failed:", error);
    return FAILED;
  }
}

/** The tools the AI stores the Student's answers with during a Brief. */
export function briefTools(actions: BriefToolActions) {
  return {
    saveBrief: tool({
      description:
        "Store the Student's answers about the exam. Send only the fields the Student just answered or changed.",
      inputSchema: saveBriefInputSchema,
      execute: (input) => run(() => actions.saveBrief(input)),
    }),
    addNote: tool({
      description:
        "Store something the Student said about the exam that no saveBrief field holds, such as a teacher's hint, what changed this year, what they know or where they struggle. Pass their words verbatim.",
      inputSchema: addNoteInputSchema,
      execute: ({ text }) => run(() => actions.addNote(text)),
    }),
    setExamScope: tool({
      description:
        "Store that the exam leaves out or stresses one Big idea or Topic, once the Student has confirmed it in their own words. Pass their words verbatim. scope null removes it.",
      inputSchema: setExamScopeInputSchema,
      execute: (input) => run(() => actions.setExamScope(input)),
    }),
  };
}
