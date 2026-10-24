import Link from "next/link";
import { Markdown } from "@/components/markdown";
import {
  fitText,
  PHASE_NAMES,
  phaseHeading,
} from "@/features/study/domain/plan";
import type { StudyPlan } from "@/features/study/types";

/**
 * The study plan as the Brief's panel lists it: the Phase, the weekly hours,
 * the fit line and the names of the in-plan Topics that won't fit.
 */
export function StudyPlanFacts({ plan }: { plan: StudyPlan }) {
  if (plan.phase === null) {
    return <p className="text-sm text-muted-foreground">No exam date</p>;
  }
  const wontFit = plan.topics.filter((topic) => topic.fits === false);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p>{phaseHeading(plan.phase)}</p>
      <p>
        <span className="text-muted-foreground">Weekly hours:</span>{" "}
        {plan.hoursPerWeek === null ? "Not set" : `${plan.hoursPerWeek} h`}
      </p>
      {plan.fit !== null && <p>{fitText(plan.phase, plan.fit)}</p>}
      {wontFit.length > 0 && (
        <div>
          <p className="text-muted-foreground">Won&apos;t fit:</p>
          <ul aria-label="Topics that won't fit" className="list-disc pl-5">
            {wontFit.map((topic) => (
              <li key={topic.id}>
                <Markdown>{topic.name}</Markdown>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The plan in one line, as the map shows it: the fit line, or what to add
 * in the Brief (`briefHref`) to see it.
 */
export function FitLine({
  plan,
  briefHref,
}: {
  plan: StudyPlan;
  briefHref: string;
}) {
  const briefLink = (text: string) => (
    <Link href={briefHref} className="underline underline-offset-4">
      {text}
    </Link>
  );
  let line;
  if (plan.phase === null) {
    line = briefLink(
      "Add your exam date and weekly hours in the Brief to see your pace.",
    );
  } else if (plan.phase === "final_week") {
    line = `${PHASE_NAMES.final_week}: review what you've learned.`;
  } else if (plan.fit === null) {
    line = (
      <>
        {phaseHeading(plan.phase)}.{" "}
        {briefLink("Add your weekly hours in the Brief to see your pace.")}
      </>
    );
  } else {
    line = fitText(plan.phase, plan.fit);
  }
  return (
    <p aria-label="Study plan" className="text-sm text-muted-foreground">
      {line}
    </p>
  );
}
