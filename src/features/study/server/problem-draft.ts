import "server-only";
import type { AnswerKey } from "@/features/knowledge-map/server";
import type { ProblemDraft } from "@/features/study/ai/generate-call";
import {
  fillPlaceholders,
  type PlaceholderValue,
} from "@/features/study/domain/placeholders";
import type { MathRunner } from "@/features/study/server/math-runner";

/** A draft that passed: its texts with the program's numbers filled in. */
export type CheckedProblem = {
  statement: string;
  solution: string;
  program: string | null;
  /** The answer keys of the declared answers' values; null without any. */
  finalAnswers: AnswerKey[] | null;
};

/**
 * Runs a draft's program with its declared final answers and fills its
 * placeholders from the values, a final answer's in its declared unit, and
 * makes each declared answer's value its answer key. The
 * error, for the retry, when the program fails or a placeholder stays
 * unresolved. Without a program, final answers are dropped and any
 * placeholder is unresolved.
 */
export async function checkDraft(
  draft: ProblemDraft,
  runner: MathRunner,
): Promise<
  { ok: true; problem: CheckedProblem } | { ok: false; error: string }
> {
  let values: Record<string, PlaceholderValue> = {};
  let finalAnswers: AnswerKey[] | null = null;
  if (draft.program !== null) {
    const run = await runner.run(draft.program, draft.finalAnswers);
    if (!run.ok) return { ok: false, error: `Program: ${run.error}` };
    values = { ...run.values };
    for (const answer of run.answers) values[answer.variable] = answer;
    finalAnswers = run.answers.map(({ variable, text }) => ({
      label: variable,
      value: text,
      anyOrder: false,
    }));
  }
  const statement = fillPlaceholders(draft.statement, values);
  if (!statement.ok)
    return { ok: false, error: `Statement: ${statement.error}` };
  const solution = fillPlaceholders(draft.solution, values);
  if (!solution.ok) return { ok: false, error: `Solution: ${solution.error}` };
  return {
    ok: true,
    problem: {
      statement: statement.text,
      solution: solution.text,
      program: draft.program,
      finalAnswers: finalAnswers?.length ? finalAnswers : null,
    },
  };
}
