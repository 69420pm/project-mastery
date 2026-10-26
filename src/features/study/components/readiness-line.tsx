import type { CourseReadiness } from "@/features/study/types";

/**
 * The map header's Readiness line: the exam weight the Student is likely to
 * recall on the day (today without an exam date ahead), labelled untested
 * until a mock is graded, then by how many mocks check it. Nothing without
 * Priorities.
 */
export function ReadinessLine({ readiness }: { readiness: CourseReadiness }) {
  if (readiness.course === null) return null;
  const percent = Math.round(readiness.course * 100);
  const when = readiness.onTheDay ? "on the day" : "today";
  const label =
    readiness.mocks === 0
      ? "untested"
      : `checked against ${readiness.mocks} ${readiness.mocks === 1 ? "mock" : "mocks"}`;
  return (
    <p>
      Exam weight you&apos;re likely to recall {when}: {percent}%{" "}
      <span className="italic">({label})</span>
    </p>
  );
}
