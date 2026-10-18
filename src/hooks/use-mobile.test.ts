import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useIsMobile } from "./use-mobile";

/** A viewport whose width the test sets, with media query change events. */
function stubViewport(width: number) {
  const listeners = new Set<() => void>();
  const viewport = { width };
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        const max = Number(/max-width: (\d+)px/.exec(query)?.[1]);
        return viewport.width <= max;
      },
      addEventListener: (_: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) =>
        listeners.delete(listener),
    })),
  );
  return {
    listeners,
    resize(to: number) {
      viewport.width = to;
      for (const listener of listeners) listener();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("is true below 768 pixels and follows the viewport", () => {
  const viewport = stubViewport(767);
  const { result, unmount } = renderHook(() => useIsMobile());
  expect(result.current).toBe(true);

  act(() => viewport.resize(768));
  expect(result.current).toBe(false);

  unmount();
  expect(viewport.listeners.size).toBe(0);
});
