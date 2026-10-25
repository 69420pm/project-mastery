import {
  EndSessionButton,
  MODE_LABELS,
  StageBar,
  type SessionMode,
  type Stage,
} from "@/features/study";

/**
 * The row above a Chat's messages: the learn session's stage bar, when it
 * has stages, the mode of a review or practice session, and End session,
 * while it can be ended.
 */
export function SessionBar({
  chatId,
  stage,
  mode,
  progress = null,
  canEnd,
  busy,
  onEnded,
  onError,
}: {
  chatId: string;
  stage: Stage | null;
  mode: SessionMode;
  /** How far a review or practice session is, such as "3 of 5 done". */
  progress?: string | null;
  canEnd: boolean;
  busy: boolean;
  onEnded: () => void;
  onError: (message: string) => void;
}) {
  const modeLabel = mode === "learn" ? null : MODE_LABELS[mode];
  if (stage === null && modeLabel === null && !canEnd) return null;
  return (
    <div className="mx-auto -mb-2 flex w-full max-w-3xl items-center gap-2 pt-2">
      {stage !== null && (
        // Beside an open side slot the eight stages may not fit.
        <div className="min-w-0 overflow-x-auto">
          <StageBar stage={stage} />
        </div>
      )}
      {modeLabel !== null && (
        <p className="text-sm font-medium">
          {progress === null ? modeLabel : `${modeLabel} · ${progress}`}
        </p>
      )}
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
