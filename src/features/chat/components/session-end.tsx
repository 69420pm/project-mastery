import { SquarePenIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { newChatPath } from "@/features/chat/domain/chat-paths";

/**
 * Where an ended session's Chat had its composer: Start new session opens a
 * new Chat in the Course.
 */
export function SessionEnded({ courseId }: { courseId: string }) {
  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 rounded-lg border bg-muted/50 px-4 py-3"
    >
      <p className="text-sm text-muted-foreground">Session ended</p>
      <Button size="sm" asChild>
        <Link href={newChatPath(courseId)}>
          <SquarePenIcon />
          Start new session
        </Link>
      </Button>
    </div>
  );
}
