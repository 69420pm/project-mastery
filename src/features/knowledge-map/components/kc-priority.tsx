import { Badge } from "@/components/ui/badge";
import { BAND_NAMES } from "@/features/knowledge-map/domain/kc-labels";
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

/** A KC's recall band badge; a KC without attempts is new. */
export function BandBadge({ learned }: { learned?: MapKcLearning[string] }) {
  const band = learned?.band ?? "new";
  return (
    <Badge
      variant={band === "weak" ? "default" : "outline"}
      aria-label={`Recall: ${BAND_NAMES[band]}`}
    >
      {BAND_NAMES[band]}
    </Badge>
  );
}

/** A KC's Priority badge; nothing for a KC without one. */
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
