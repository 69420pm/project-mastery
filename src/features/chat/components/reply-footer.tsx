import { tokensText } from "@/features/chat/domain/reply-usage";
import { costText } from "@/lib/ai/cost";
import type { ChatMessageMetadata } from "@/features/chat/types";

/**
 * The answering model of an AI reply, with its tokens and cost when known.
 * Older replies have only their model.
 */
export function ReplyFooter({
  metadata,
}: {
  metadata: ChatMessageMetadata | undefined;
}) {
  const { modelId, usage } = metadata ?? {};
  if (!modelId && !usage) return null;
  const parts = [
    modelId,
    usage && tokensText(usage),
    usage && `${costText(usage.costUsd)}${usage.estimated ? " estimated" : ""}`,
  ].filter(Boolean);
  return (
    <span
      data-testid="reply-footer"
      className="ml-1 truncate text-xs tabular-nums"
    >
      {parts.join(" · ")}
    </span>
  );
}
