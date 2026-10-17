import { Badge } from "@/components/ui/badge";
import { SOLUTION_STATUS_NAMES } from "@/features/knowledge-map/domain/kc-labels";
import type { SolutionStatus } from "@/features/knowledge-map/schemas";
import { cn } from "@/lib/utils";

/** An Exercise's solution status; a disputed one in the warning colour. */
export function SolutionBadge({
  status,
  className,
}: {
  status: SolutionStatus;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      aria-label={`Solution: ${SOLUTION_STATUS_NAMES[status]}`}
      className={cn(
        status === "disputed" &&
          "border-warning bg-warning text-warning-foreground",
        status === "verified" && "border-success text-success",
        className,
      )}
    >
      {SOLUTION_STATUS_NAMES[status]}
    </Badge>
  );
}
