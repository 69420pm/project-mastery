import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  /** The page's level-1 heading. */
  title: ReactNode;
  /** One line under the title on what the page is for. */
  description?: ReactNode;
  /** Buttons beside the title, such as the page's main action. */
  actions?: ReactNode;
  /** Shown above the title, such as a back link. */
  eyebrow?: ReactNode;
  className?: string;
};

/** The heading block every signed-in page starts with. */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      {eyebrow}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight break-words">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
    </header>
  );
}
