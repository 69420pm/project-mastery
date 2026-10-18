import { GraduationCapIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** The product's mark and name, as the sidebar and the sign-in pages show it. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 font-semibold tracking-tight",
        className,
      )}
    >
      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
      >
        <GraduationCapIcon className="size-4" />
      </span>
      <span className="truncate">Project Mastery</span>
    </span>
  );
}
