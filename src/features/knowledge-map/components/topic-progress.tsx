import { Badge } from "@/components/ui/badge";
import type { MapTopicProgress } from "@/features/knowledge-map/types";

type Progress = MapTopicProgress[string];

const STATES: Record<
  Progress["state"],
  { name: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  new: { name: "New", variant: "outline" },
  in_progress: { name: "In progress", variant: "outline" },
  learned: { name: "Learned", variant: "secondary" },
  solid: { name: "Solid", variant: "default" },
  needs_work: { name: "Needs work", variant: "destructive" },
};

/** A Topic's state as a badge; new without progress. */
export function TopicStateBadge({ progress }: { progress?: Progress }) {
  const state = STATES[progress?.state ?? "new"];
  return (
    <Badge variant={state.variant} aria-label={`Topic state: ${state.name}`}>
      {state.name}
    </Badge>
  );
}

/** A Topic's recall today as a labelled bar; 0 without progress. */
export function RecallBar({ progress }: { progress?: Progress }) {
  const percent = Math.round((progress?.recall ?? 0) * 100);
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
