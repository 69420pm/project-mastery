import Link from "next/link";
import { briefPath } from "@/features/brief/domain/brief-paths";

/** Invites the Student to the Brief while they have not finished it. */
export function BriefHint({ courseId }: { courseId: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4 sm:px-6">
      <Link
        href={briefPath(courseId)}
        className="block rounded-xl border bg-muted/50 px-4 py-3 text-sm font-medium hover:bg-muted"
      >
        Tell the AI about your exam
      </Link>
    </div>
  );
}
