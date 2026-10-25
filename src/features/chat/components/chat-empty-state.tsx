import { GraduationCapIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ConversationEmptyState } from "@/components/ai-elements/conversation";

const DEFAULT_EMPTY_DESCRIPTION =
  "Say hi and the AI picks up with what's next on your map, or ask about anything.";

/**
 * A Chat without messages: a heading, and under it `children`, such as the
 * Today card, or else a line on how to start.
 */
export function ChatEmptyState({ children }: { children?: ReactNode }) {
  return (
    <ConversationEmptyState>
      <div
        aria-hidden
        className="flex size-11 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground"
      >
        <GraduationCapIcon className="size-5" />
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold tracking-tight">
          Ready to study?
        </h2>
        {!children && (
          <p className="max-w-md text-sm text-balance text-muted-foreground">
            {DEFAULT_EMPTY_DESCRIPTION}
          </p>
        )}
      </div>
      {children}
    </ConversationEmptyState>
  );
}
