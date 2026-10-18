import { ChevronRightIcon, MessageSquareTextIcon } from "lucide-react";
import Link from "next/link";
import { briefPath } from "@/features/brief/domain/brief-paths";

/** Invites the Student to the Brief while they have not finished it. */
export function BriefHint({ courseId }: { courseId: string }) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 pt-6 sm:px-6">
      <Link
        href={briefPath(courseId)}
        aria-labelledby="brief-hint-title"
        aria-describedby="brief-hint-description"
        className="group flex items-center gap-3 rounded-xl border bg-muted/40 px-4 py-3 transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MessageSquareTextIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span id="brief-hint-title" className="text-sm font-medium">
            Tell the AI about your exam
          </span>
          <span
            id="brief-hint-description"
            className="text-sm text-muted-foreground"
          >
            Its date, format and your goal shape your study plan.
          </span>
        </span>
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        />
      </Link>
    </div>
  );
}
