import { chatEval } from "./chat";
import { closeEval } from "./close";
import { disagreementEval } from "./disagreement";
import type { EvalDefinition } from "./eval";
import { generateEval, generateRealEval } from "./generate";
import { gradeEval } from "./grade";
import { gradeExamEval } from "./grade-exam";
import { learnEval } from "./learn";
import { readingEval } from "./reading";
import { reviewEval } from "./review";

/** A registered eval whose input and expected-output types are erased. */
export type RegisteredEval = EvalDefinition<unknown, unknown>;

// An eval's task takes its own input type, so a typed definition does not
// assign to the erased one without a cast. Every consumer re-parses items
// with the definition's own schemas.
function register<Input, Expected>(
  definition: EvalDefinition<Input, Expected>,
) {
  return definition as unknown as RegisteredEval;
}

// Register each eval here; its fixture is `evals/datasets/<name>.json`.
export const EVALS: RegisteredEval[] = [
  register(chatEval),
  register(closeEval),
  register(disagreementEval),
  register(generateEval),
  register(generateRealEval),
  register(gradeEval),
  register(gradeExamEval),
  register(learnEval),
  register(readingEval),
  register(reviewEval),
];
