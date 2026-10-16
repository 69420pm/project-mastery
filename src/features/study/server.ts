// Public API of the study feature for server code only: what the AI needs to
// tutor a Student in a Chat. It reads the Knowledge map through the
// knowledge-map feature, Priorities through priorities, the exam date
// through brief and chunks through ingestion.
import "server-only";

export { tutorInstructions } from "./ai/instructions";
export { TutorToolError, type TutorTools } from "./ai/tools";
export { startTutoring } from "./server/tutoring";
export type { TutorContext } from "./types";
