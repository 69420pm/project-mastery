"use client";

import { SquareIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { endStudySession } from "@/features/study/server/actions";

/** Ends a Chat's Study session now, for the Chat's header. */
export function EndSessionButton({
  chatId,
  disabled,
  onEnded,
  onError,
}: {
  chatId: string;
  /** As while a reply is on its way. */
  disabled: boolean;
  onEnded: () => void;
  onError: (message: string) => void;
}) {
  const [ending, setEnding] = useState(false);

  async function end() {
    setEnding(true);
    try {
      const result = await endStudySession({ chatId });
      if (result.ok) onEnded();
      else onError(result.message);
    } catch {
      onError("The session could not be ended. Try again.");
    } finally {
      setEnding(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled || ending}
      onClick={() => void end()}
    >
      <SquareIcon />
      End session
    </Button>
  );
}
