import Link from "next/link";
import type { StudyPlan } from "@/features/study/types";

const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;

/**
 * The plan's Progress as a bar and one line, such as `34 of 120 KCs known ·
 * 12 days in · 30 days left`, leaving out the parts it lacks. Without an exam
 * date and given `briefHref`, it links to the Brief to add one. Without
 * in-plan KCs, only `empty` if given, else nothing.
 */
export function ProgressLine({
  plan,
  briefHref,
  empty,
}: {
  plan: Pick<StudyPlan, "progress" | "examDate">;
  /** The Brief, linked to when the Course has no exam date. */
  briefHref?: string;
  /** Shown instead of the line without in-plan KCs. */
  empty?: string;
}) {
  const { known, total, daysIn, daysLeft } = plan.progress;
  if (total === 0) {
    return empty ? <p className="text-muted-foreground">{empty}</p> : null;
  }
  const parts = [
    `${known} of ${total} ${total === 1 ? "KC" : "KCs"} known`,
    ...(daysIn === null ? [] : [`${days(daysIn)} in`]),
    ...(daysLeft === null
      ? []
      : [daysLeft === 0 ? "Exam today" : `${days(daysLeft)} left`]),
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div
        role="progressbar"
        aria-label="Progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={known}
        className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full bg-primary"
          style={{ width: `${(known / total) * 100}%` }}
        />
      </div>
      <p>{parts.join(" · ")}</p>
      {briefHref && plan.examDate === null && (
        <Link href={briefHref} className="underline underline-offset-4">
          Add your exam date in the Brief
        </Link>
      )}
    </div>
  );
}
