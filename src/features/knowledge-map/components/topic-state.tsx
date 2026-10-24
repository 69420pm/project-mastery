import { Badge } from "@/components/ui/badge";
import type { MapTopicState } from "@/features/knowledge-map/types";

const STATES: Record<
  MapTopicState["state"],
  { name: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  new: { name: "New", variant: "outline" },
  in_progress: { name: "In progress", variant: "outline" },
  learned: { name: "Learned", variant: "secondary" },
  solid: { name: "Solid", variant: "default" },
  needs_work: { name: "Needs work", variant: "destructive" },
};

/** A Topic's state as a badge; new without one. */
export function TopicStateBadge({
  topicState,
}: {
  topicState?: MapTopicState;
}) {
  const state = STATES[topicState?.state ?? "new"];
  return (
    <Badge variant={state.variant} aria-label={`Topic state: ${state.name}`}>
      {state.name}
    </Badge>
  );
}

/** A Topic's study plan badges, such as "won't fit"; nothing without. */
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

/** A Topic's recall today as a labelled bar; 0 without a Topic state. */
export function RecallBar({ topicState }: { topicState?: MapTopicState }) {
  const percent = Math.round((topicState?.recall ?? 0) * 100);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">
        Recall today {percent}%
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
