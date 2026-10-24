// Public API of the study feature for any code: the AI's instructions in a
// Chat, built from the tutor context, and the views of what study owns (the
// Memory card and the study plan), which pages pass into the Brief's panel
// and the map as slots. Server-only exports live in `server.ts`.
export { tutorInstructions } from "./ai/instructions";
export { EndSessionButton } from "./components/end-session-button";
export { MemoryCard } from "./components/memory-card";
export { FitLine, LeftOutBadge, StudyPlanFacts } from "./components/study-plan";
export { TodayCard } from "./components/today-card";
export { PHASE_NAMES, topicBadges } from "./domain/plan";
export { recallText, scheduleText } from "./domain/schedule-text";
export { sessionEndedMessage } from "./schemas";
export type {
  ExerciseView,
  GradedKc,
  KcReading,
  QuestionKind,
  StudyPlan,
  TutorContext,
  TutorToday,
} from "./types";
