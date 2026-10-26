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
// For the `review` eval, which builds the queue and replays its attempts in
// memory.
export { replayKc, type ReplayAttempt } from "./domain/replay";
export { planReviewQueue, type ReviewGroup } from "./domain/review-queue";
export { getKcStates } from "./server/attempts";
export { getKcLearning } from "./server/learning";
export { getExamToReport } from "./server/exam-to-report";
export { getMapFindings } from "./server/map-findings-card";
export {
  mathRunner,
  type DeclaredAnswer,
  type MathRunner,
  type ProgramRun,
} from "./server/math-runner";
export { getMemory } from "./server/memory";
export { getMockExam, getOpenMockExam } from "./server/mock-exams";
export { getPlan } from "./server/plan";
export { getReadiness } from "./server/readiness";
export { loadProblemFlags } from "./server/problems";
export {
  isAnswerable,
  loadAnswerLinks,
  recordAnswer,
} from "./server/questions";
export { sessionEndedMessage } from "./schemas";
export {
  closeIdleSession,
  endIdleSessions,
  getSessionEnd,
  getSessionMode,
  startSessionMode,
} from "./server/sessions";
export { getTopicStates } from "./server/topic-states";
export { startTutoring } from "./server/tutoring";
// For the `generate` smoke check, which runs a queued run in process and
// looks the variant up as the tutor would.
export { findProblems } from "./server/find-problems";
export { generateProblems } from "./workflows/generate-problems";
// For the `mock` smoke check, which assembles a queued mock in process.
export { assembleMock } from "./workflows/assemble-mock";
// For the `grade-mock` smoke check, which grades a submitted mock in process,
// and the `grade_exam` eval, which runs the call without a database.
export { gradeMock } from "./workflows/grade-mock";
export { awardedPoints, checkMockValue } from "./domain/mock-grading";
// For the `close` smoke check, which closes an ended session in process, and
// the `close` eval, which runs the call without a database.
export { closeStudySession } from "./workflows/close-study-session";
export { closeCall } from "./ai/close-call";
export {
  buildCloseInput,
  guardedNotes,
  keepsPinnedLines,
  pinnedLines,
  type CloseInput,
  type CloseNotes,
  type CloseSource,
} from "./domain/close";
export {
  gradeExamCall,
  type ExamGrading,
  type GradeExamInput,
} from "./ai/grade-exam-call";
// For the `generate` eval, which runs the workflow's call and check without
// a database.
export {
  generateCall,
  retryMessages,
  type GenerateInput,
} from "./ai/generate-call";
export { checkDraft } from "./server/problem-draft";
export type {
  GradedKc,
  KcState,
  KcStateName,
  Phase,
  StudyPlan,
  TutorContext,
} from "./types";
