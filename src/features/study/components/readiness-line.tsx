import type { StudyState } from "@/features/study/types";

/**
 * The map header's Readiness line: the exam weight the Student is likely to
 * recall on the day (today without an exam date ahead), with the latest
 * graded mock's score beside it when there is one. Nothing without
 * Priorities.
 */
export function ReadinessLine({
  state,
}: {
  state: Pick<StudyState, "readiness" | "lastMockPercent">;
}) {
  const { course, onTheDay } = state.readiness;
  if (course === null) return null;
  const when = onTheDay ? "on the day" : "today";
  return (
    <p>
      Exam weight you&apos;re likely to recall {when}:{" "}
      {Math.round(course * 100)}%
      {state.lastMockPercent !== null &&
        ` · Last mock: ${state.lastMockPercent}%`}
    </p>
  );
}
