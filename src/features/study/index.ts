// Public API of the study feature for any code: the AI's instructions in a
// Chat, built from the tutor context. Server-only exports live in
// `server.ts`.
export { tutorInstructions } from "./ai/instructions";
export type { TutorContext } from "./types";
