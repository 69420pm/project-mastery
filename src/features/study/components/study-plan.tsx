import Link from "next/link";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { type Phase, PHASE_NAMES } from "@/features/study/domain/plan";
import type { StudyPlan } from "@/features/study/types";

/** A Phase as a heading: "Build phase", "Deepen phase" or "Final week". */
const phaseHeading = (phase: Phase) =>
  phase === "final_week" ? PHASE_NAMES[phase] : `${PHASE_NAMES[phase]} phase`;

/**
 * The study plan as the Brief's panel lists it: the Phase, the weekly hours,
 * the share of the KCs that matter that fit and the names of those that
 * won't.
 */
export function StudyPlanFacts({ plan }: { plan: StudyPlan }) {
  if (plan.phase === null) {
    return <p className="text-sm text-muted-foreground">No exam date</p>;
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p>{phaseHeading(plan.phase)}</p>
      <p>
        <span className="text-muted-foreground">Weekly hours:</span>{" "}
        {plan.hoursPerWeek === null ? "Not set" : `${plan.hoursPerWeek} h`}
      </p>
      {plan.share !== null && (
        <p>
          <span className="text-muted-foreground">
            KCs that matter and fit before the final week:
          </span>{" "}
          {plan.share}%
        </p>
      )}
      {plan.leftOut.length > 0 && (
        <div>
          <p className="text-muted-foreground">Left out:</p>
          <ul aria-label="Left-out KCs" className="list-disc pl-5">
            {plan.leftOut.map((kc) => (
              <li key={kc.id}>
                <Markdown>{kc.name}</Markdown>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The plan in one line, as the map shows it: the Phase and how much of what
 * matters fits the weekly hours, or what to add in the Brief (`briefHref`)
 * to see it.
 */
export function PlanLine({
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
  } else if (plan.share === null || plan.hoursPerWeek === null) {
    line = (
      <>
        {phaseHeading(plan.phase)}.{" "}
        {briefLink("Add your weekly hours in the Brief to see your pace.")}
      </>
    );
  } else {
    const count = plan.leftOut.length;
    const fit =
      count === 0
        ? "all KCs that matter fit."
        : `about ${plan.share}% of the KCs that matter fit; ${count} lowest-Priority ${count === 1 ? "KC won't" : "KCs won't"}.`;
    line = `${phaseHeading(plan.phase)}. At ${plan.hoursPerWeek} h/week until the final week, ${fit}`;
  }
  return (
    <p aria-label="Study plan" className="text-sm text-muted-foreground">
      {line}
    </p>
  );
}

/** Marks a KC the weekly hours won't fit before the final week. */
export function LeftOutBadge() {
  return (
    <Badge variant="outline" className="text-muted-foreground">
      won&apos;t fit
    </Badge>
  );
}
