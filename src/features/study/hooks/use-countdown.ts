"use client";

import { useEffect, useEffectEvent, useState } from "react";

/**
 * The milliseconds left until `deadline`, ticking each second, on the
 * server's clock: `serverNow` is the server's time when the page loaded, so
 * a wrong clock on the Student's device does not change the time left.
 * Calls `onExpire` once when it reaches 0.
 */
export function useCountdown(
  deadline: string,
  serverNow: string,
  onExpire: () => void,
): number {
  const [offset] = useState(() => Date.parse(serverNow) - Date.now());
  const [remaining, setRemaining] = useState(() => msLeft(deadline, offset));
  const expire = useEffectEvent(onExpire);

  useEffect(() => {
    if (msLeft(deadline, offset) === 0) {
      expire();
      return;
    }
    const timer = setInterval(() => {
      const next = msLeft(deadline, offset);
      setRemaining(next);
      if (next === 0) {
        clearInterval(timer);
        expire();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline, offset]);

  return remaining;
}

function msLeft(deadline: string, offset: number): number {
  return Math.max(0, Date.parse(deadline) - (Date.now() + offset));
}

/** Milliseconds as the countdown shows them: 1:05:09, or 4:09 under an hour. */
export function countdownText(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}
