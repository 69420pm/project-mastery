import { EndSessionButton, StageBar, type Stage } from "@/features/study";

/**
 * The row above a Chat's messages: the learn session's stage bar, when it
 * has stages, and End session, while it can be ended.
 */
export function SessionBar({
  chatId,
  stage,
  canEnd,
  busy,
  onEnded,
  onError,
}: {
  chatId: string;
  stage: Stage | null;
  canEnd: boolean;
  busy: boolean;
  onEnded: () => void;
  onError: (message: string) => void;
}) {
  if (stage === null && !canEnd) return null;
  return (
    <div className="mx-auto -mb-2 flex w-full max-w-3xl items-center gap-2 pt-2">
      {stage !== null && <StageBar stage={stage} />}
      {canEnd && (
        <div className="ml-auto">
          <EndSessionButton
            chatId={chatId}
            disabled={busy}
            onEnded={onEnded}
            onError={onError}
          />
        </div>
      )}
    </div>
  );
}
