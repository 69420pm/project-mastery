"use client";

import { RefreshCwIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  MessageAction,
  MessageActions,
} from "@/components/ai-elements/message";
import { CopyAction } from "@/features/chat/components/copy-action";
import { cn } from "@/lib/utils";

/**
 * The quiet row of actions under a message. It is always there, so the
 * messages above do not move when it appears: while a reply is on its way it
 * is only hidden, keeping its space.
 */
export function MessageActionRow({
  from,
  text,
  stopped,
  hidden,
  onRegenerate,
  children,
}: {
  from: "user" | "assistant";
  /** The message's text, which Copy copies. */
  text: string;
  /** Whether the reply was stopped before it ended. */
  stopped?: boolean;
  /** Keeps the row's space but shows nothing and takes no clicks. */
  hidden?: boolean;
  /** Offers Regenerate, for the last reply. */
  onRegenerate?: () => void;
  /** More actions, after Copy and Regenerate. */
  children?: ReactNode;
}) {
  return (
    <MessageActions
      aria-hidden={hidden || undefined}
      className={cn(
        "gap-0.5 text-muted-foreground/60",
        from === "user" && "justify-end",
        hidden && "invisible",
      )}
    >
      {stopped && <span className="px-1 text-xs">Stopped</span>}
      <CopyAction text={text} />
      {onRegenerate && (
        <MessageAction
          tooltip="Regenerate"
          size="icon-xs"
          className="hover:text-foreground"
          onClick={onRegenerate}
        >
          <RefreshCwIcon />
        </MessageAction>
      )}
      {children}
    </MessageActions>
  );
}
