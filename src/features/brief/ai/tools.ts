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
  scopeConfirmed: z
    .boolean()
    .nullish()
    .describe(
      "True once the Student has said which Materials the exam covers, including when it covers all of them.",
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

/** What `answerFinding` takes: a question about the materials and the answer. */
const answerFindingInputSchema = z.object({
  findingId: z
    .string()
    .describe("The id of the question the Student answered."),
  answer: z
    .string()
    .min(1)
    .max(2000)
    .describe("The Student's answer, word for word as they wrote it."),
});

/**
 * What the tools do with the Student's answers. Each returns the message
 * the model gets back; a refusal changes nothing.
 */
export type BriefToolActions = {
  saveBrief: (input: SaveBriefInput) => Promise<string>;
  addNote: (text: string) => Promise<string>;
  answerFinding: (findingId: string, answer: string) => Promise<string>;
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
    answerFinding: tool({
      description:
        "Store the Student's answer to a question about the Course's materials, verbatim. The result says which question to ask next.",
      inputSchema: answerFindingInputSchema,
      execute: ({ findingId, answer }) =>
        run(() => actions.answerFinding(findingId, answer)),
    }),
  };
}
