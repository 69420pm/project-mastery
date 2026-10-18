import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  /** An icon that says what is missing. */
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** What to do about it, such as a button. */
  action?: ReactNode;
  /** The title's heading element: `h1` when it is the whole page. */
  heading?: "h1" | "h2";
  className?: string;
};

/** What a page or list shows while it has nothing to show yet. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  heading: Heading = "h2",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      <div
        aria-hidden
        className="flex size-11 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground [&_svg]:size-5"
      >
        {icon}
      </div>
      <div className="flex flex-col gap-1.5">
        <Heading className="font-medium">{title}</Heading>
        {description && (
          <p className="max-w-sm text-sm text-balance text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
