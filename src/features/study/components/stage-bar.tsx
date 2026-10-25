import { CheckIcon } from "lucide-react";
import {
  STAGE_NAMES,
  STAGES,
  type Stage,
} from "@/features/study/domain/stages";
import { cn } from "@/lib/utils";

/**
 * Where a learn session stands: its eight stages, the current one marked
 * and the earlier ones done. Below `lg` only the current stage shows.
 */
export function StageBar({ stage }: { stage: Stage }) {
  const current = STAGES.indexOf(stage);
  return (
    <nav aria-label="Session stages">
      <ol className="flex items-center gap-1 text-xs">
        {STAGES.map((name, index) => {
          const done = index < current;
          const isCurrent = index === current;
          return (
            <li
              key={name}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "items-center gap-1 rounded-full px-2 py-0.5",
                isCurrent
                  ? "flex bg-primary font-medium text-primary-foreground"
                  : "hidden lg:flex",
                done && "text-muted-foreground",
                !done && !isCurrent && "text-muted-foreground/60",
              )}
            >
              {done && <CheckIcon aria-hidden className="size-3" />}
              {STAGE_NAMES[name]}
              {done && <span className="sr-only"> (done)</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
