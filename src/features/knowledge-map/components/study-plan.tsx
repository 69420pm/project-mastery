import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { MapPlan } from "@/features/knowledge-map/types";

const PHASE_NAMES = { build: "Build phase", deepen: "Deepen phase" } as const;

/**
 * The plan in one line: the Phase and how much of what matters fits the
 * weekly hours, or what to add in the Brief (`briefHref`) to see it.
 */
export function PlanLine({
  plan,
  briefHref,
}: {
  plan: MapPlan;
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
    line = "Final week: review what you've learned.";
  } else if (plan.share === null || plan.hoursPerWeek === null) {
    line = (
      <>
        {PHASE_NAMES[plan.phase]}.{" "}
        {briefLink("Add your weekly hours in the Brief to see your pace.")}
      </>
    );
  } else {
    const count = plan.leftOut.length;
    const fit =
      count === 0
        ? "all KCs that matter fit."
        : `about ${plan.share}% of the KCs that matter fit; ${count} lowest-Priority ${count === 1 ? "KC won't" : "KCs won't"}.`;
    line = `${PHASE_NAMES[plan.phase]}. At ${plan.hoursPerWeek} h/week until the final week, ${fit}`;
  }
  return (
    <p aria-label="Study plan" className="text-sm text-muted-foreground">
      {line}
    </p>
  );
}

/** Marks a KC the weekly hours won't fit before the final week. */
export function LeftOutBadge({ leftOut }: { leftOut: boolean }) {
  if (!leftOut) return null;
  return (
    <Badge variant="outline" className="text-muted-foreground">
      won&apos;t fit
    </Badge>
  );
}
