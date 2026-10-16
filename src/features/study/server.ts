// Public API of the study feature for server code only: what the AI needs to
// tutor a Student in a Chat. It reads the Knowledge map through the
// knowledge-map feature, Priorities through priorities, the exam facts
// through brief and chunks through ingestion. It owns the attempts log, the
// review ladder replayed from it, the study plan (Phase and pacing)
// derived on read, and the Memory the AI keeps per Course. The instructions, which are
// pure, live in `index.ts`.
import "server-only";

// Also here for the Chat's reply settings: `index.ts` loads the Memory card,
// whose React components fail to import outside Next.js (evals, smoke checks).
export { tutorInstructions } from "./ai/instructions";
export { TutorToolError, type TutorTools } from "./ai/tools";
export { getKcStates } from "./server/attempts";
export { getKcLearning } from "./server/learning";
export { getMemory } from "./server/memory";
export { getOpeningLine } from "./server/opening";
export { getPlan } from "./server/plan";
export { startTutoring } from "./server/tutoring";
export type {
  KcState,
  KcStateName,
  Phase,
  StudyPlan,
  TutorContext,
} from "./types";
