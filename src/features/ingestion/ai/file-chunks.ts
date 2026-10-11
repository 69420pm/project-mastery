import "server-only";
import { Output } from "ai";
import { z } from "zod";
import type { MaterialUnit } from "@/features/ingestion/domain/file-chunks";
import { CHUNK_LABELS } from "@/features/ingestion/types";
import { aiTask } from "@/lib/ai/models";

/**
 * What the file call returns for a Material whose units have these ids. The
 * ids are an enum, so the model can only name units that exist; that every
 * unit lands in exactly one chunk is checked in code (`coverageProblems`).
 */
export function fileResultSchema(unitIds: readonly [string, ...string[]]) {
  return z.object({
    chunks: z
      .array(
        z.object({
          unitIds: z
            .array(z.enum(unitIds))
            .min(1)
            .describe("The ids of the neighbouring units, in reading order."),
          label: z.enum(CHUNK_LABELS),
          exerciseNumber: z
            .string()
            .nullable()
            .describe(
              "For an exercise or its solution: the number as printed, with its subtask, such as 7.2a. Else null.",
            ),
          points: z
            .number()
            .nullable()
            .describe("The points this exercise or subtask is worth, or null."),
        }),
      )
      .describe("The Material's chunks in reading order."),
    exam: z
      .object({
        isOldExam: z.boolean(),
        year: z
          .number()
          .int()
          .nullable()
          .describe("The year the exam was set, or null."),
        totalPoints: z
          .number()
          .nullable()
          .describe("The exam's total points as printed, or null."),
      })
      .nullable()
      .describe("For an old exam, its year and total points. Else null."),
  });
}

export type FileResult = z.infer<ReturnType<typeof fileResultSchema>>;

const FILE_INSTRUCTIONS = `You get every unit of one course material (slides, a script, an exercise sheet, a solution sheet or an old exam) in reading order, as JSON: its id, page, label, exercise number and points, whether it continues from the previous page or onto the next, and its Markdown. Group the units into the material's final chunks.

- A chunk is one or more neighbouring units that belong together by the material's structure. A definition, section, example or solution that runs over a page break is one chunk. Units that stand on their own stay separate chunks.
- Put every unit into exactly one chunk, and keep the reading order. Refer to units by id; do not rewrite their content.
- Give each chunk one label: content, definition, example, exercise, solution, figure, or admin (organizational remarks such as "not exam-relevant").
- Split an exercise into one chunk per subtask. Give each subtask its full number as printed with its exercise, such as 7.2a, and its points. A statement shared by all subtasks is its own chunk with the exercise's number, such as 7.2. A solution gets the number of the exercise it solves.
- If the material is an old exam, give the exam block with its year and total points, where shown. Otherwise the exam block is null.`;

/**
 * Call settings for the file call of a parse (task `ingest`):
 *
 *   generateText({ ...fileCallSettings(units), messages: fileMessages(units) })
 */
export function fileCallSettings(
  units: readonly [MaterialUnit, ...MaterialUnit[]],
) {
  const ids = units.map((unit) => unit.id) as [string, ...string[]];
  return {
    ...aiTask("ingest"),
    instructions: FILE_INSTRUCTIONS,
    output: Output.object({ schema: fileResultSchema(ids) }),
  };
}

/** The user message of a file call: every unit, by id, as JSON. */
export function fileMessages(units: readonly MaterialUnit[]) {
  const text = JSON.stringify({
    units: units.map(({ id, pageNumber, unit }) => ({
      id,
      page: pageNumber,
      label: unit.label,
      exerciseNumber: unit.exerciseNumber,
      points: unit.points,
      continuesFromPreviousPage: unit.continuesFromPreviousPage,
      continuesOnNextPage: unit.continuesOnNextPage,
      markdown: unit.markdown,
    })),
  });
  return [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text }],
    },
  ];
}
