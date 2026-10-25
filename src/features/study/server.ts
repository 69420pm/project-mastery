// Public API of the study feature for server code only: what the AI needs to
// tutor a Student in a Chat. It reads the Knowledge map through the
// knowledge-map feature, Priorities through priorities, the exam facts
// through brief and chunks through ingestion. It owns the attempts log, the
// FSRS cards replayed from it, the study plan (Phase and pacing)
// derived on read, and the Memory the AI keeps per Course. The instructions, which are
// pure, live in `index.ts`.
import "server-only";

// Also here for the Chat's reply settings: `index.ts` loads the Memory card,
// whose React components fail to import outside Next.js (evals, smoke checks).
export { tutorInstructions } from "./ai/instructions";
export {
  endsReply,
  TutorToolError,
  tutorTools,
  type TutorToolActions,
  type TutorTools,
} from "./ai/tools";
// Also here for the `learn` eval, which can't load `index.ts` either.
export { STAGES, type Stage } from "./domain/stages";
export { getKcStates } from "./server/attempts";
export { getKcLearning } from "./server/learning";
export { getMapFindings } from "./server/map-findings-card";
export {
  mathRunner,
  type DeclaredAnswer,
  type MathRunner,
  type ProgramRun,
} from "./server/math-runner";
export { getMemory } from "./server/memory";
export { getPlan } from "./server/plan";
export { loadProblemFlags } from "./server/problems";
export {
  isAnswerable,
  loadAnswerLinks,
  recordAnswer,
} from "./server/questions";
export { sessionEndedMessage } from "./schemas";
export { closeIdleSession, getSessionEnd } from "./server/sessions";
export { getTopicStates } from "./server/topic-states";
export { startTutoring } from "./server/tutoring";
// For the `generate` smoke check, which runs a queued run in process and
// looks the variant up as the tutor would.
export { findProblems } from "./server/find-problems";
export { generateProblems } from "./workflows/generate-problems";
export type {
  GradedKc,
  KcState,
  KcStateName,
  Phase,
  StudyPlan,
  TutorContext,
} from "./types";
