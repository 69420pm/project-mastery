import { Badge } from "@/components/ui/badge";
import type { MapTopicStudy } from "@/features/knowledge-map/types";

/** A Topic's study plan badges, such as "pinned"; nothing without. */
export function PlanBadges({ badges = [] }: { badges?: string[] }) {
  if (badges.length === 0) return null;
  return (
    <div aria-label="Plan" className="flex flex-wrap gap-1">
      {badges.map((badge) => (
        <Badge key={badge} variant="outline" className="text-muted-foreground">
          {badge}
        </Badge>
      ))}
    </div>
  );
}

/**
 * Where the Student stands on a Topic: "n of m learned" and its Readiness
 * as a labelled bar. Nothing without a study.
 */
export function TopicStudyLine({ study }: { study?: MapTopicStudy }) {
  if (!study) return null;
  const percent = Math.round((study.readiness ?? 0) * 100);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">
        {study.learned} of {study.total} learned
        {study.readiness !== null && ` · Readiness ${percent}%`}
      </span>
      <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
