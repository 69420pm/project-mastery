import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { STATE_NAMES } from "@/features/knowledge-map/domain/kc-labels";
import type {
  MapKcLearning,
  MapPriorities,
} from "@/features/knowledge-map/types";

type KcPriority = MapPriorities["kcs"][string];

const LEVELS: Record<
  KcPriority["level"],
  { name: string; variant: "default" | "secondary" | "outline" }
> = {
  high: { name: "High priority", variant: "default" },
  medium: { name: "Medium priority", variant: "secondary" },
  low: { name: "Low priority", variant: "outline" },
  excluded: { name: "Excluded", variant: "outline" },
};

/** Whether the priorities are being computed, or why the last run failed. */
export function PriorityStatus({ priorities }: { priorities: MapPriorities }) {
  if (priorities.running) {
    return (
      <p
        role="status"
        aria-label="Priority status"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Spinner className="size-3" />
        Updating priorities…
      </p>
    );
  }
  if (priorities.failureReason) {
    return (
      <p
        role="status"
        aria-label="Priority status"
        className="text-sm text-destructive"
      >
        {priorities.failureReason}
      </p>
    );
  }
  return null;
}

/** A KC's state badge; a KC without attempts is new. */
export function StateBadge({ state }: { state?: MapKcLearning[string] }) {
  const name = state?.state ?? "new";
  return (
    <Badge
      variant={name === "due" ? "default" : "outline"}
      aria-label={`State: ${STATE_NAMES[name]}`}
    >
      {STATE_NAMES[name]}
    </Badge>
  );
}

/** A KC's Priority badge; nothing before the first run. */
export function PriorityBadge({ priority }: { priority?: KcPriority }) {
  if (!priority) return null;
  const level = LEVELS[priority.level];
  return <Badge variant={level.variant}>{level.name}</Badge>;
}

/** Why a KC has its Priority, one line each. */
export function PriorityReasons({ priority }: { priority?: KcPriority }) {
  if (!priority || priority.reasons.length === 0) return null;
  return (
    <ul
      aria-label="Priority reasons"
      className="flex flex-col text-xs text-muted-foreground"
    >
      {priority.reasons.map((reason, index) => (
        // Reasons are a fixed list per render and may repeat a line.
        <li key={index}>{reason}</li>
      ))}
    </ul>
  );
}
