import { useSyncExternalStore } from "react";

/** Tailwind's `lg` breakpoint. */
const WIDE_QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(WIDE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * Whether the viewport is `lg` or wider, for a panel that sits beside the
 * content there and in a Sheet below; false while rendering on the server.
 */
export function useIsWide() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}
