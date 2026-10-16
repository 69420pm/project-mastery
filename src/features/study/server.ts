// Public API of the study feature for server code only: what the AI needs to
// tutor a Student in a Chat. It reads the Knowledge map through the
// knowledge-map feature, Priorities through priorities, the exam date
// through brief and chunks through ingestion. It owns the attempts log and
// the review ladder replayed from it. The instructions, which are
// pure, live in `index.ts`.
import "server-only";

export { TutorToolError, type TutorTools } from "./ai/tools";
export { getKcStates } from "./server/attempts";
export { startTutoring } from "./server/tutoring";
export type { KcState, KcStateName, TutorContext } from "./types";
