import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useElementWidth } from "./use-element-width";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("reports the element's content width, rounded down, until unmounted", () => {
  let report: ResizeObserverCallback = () => {};
  const disconnect = vi.fn();
  const observed: Element[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        report = callback;
      }
      observe(element: Element) {
        observed.push(element);
      }
      disconnect = disconnect;
    },
  );
  const element = document.createElement("div");
  const ref = { current: element };
  const resize = (width: number) =>
    act(() =>
      report(
        [{ contentRect: { width } } as ResizeObserverEntry],
        {} as ResizeObserver,
      ),
    );

  const { result, unmount } = renderHook(() => useElementWidth(ref));
  expect(result.current).toBeUndefined();
  expect(observed).toEqual([element]);

  resize(600.7);
  expect(result.current).toBe(600);
  resize(320);
  expect(result.current).toBe(320);

  unmount();
  expect(disconnect).toHaveBeenCalled();
});

test("observes nothing without an element", () => {
  const observe = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = observe;
      disconnect() {}
    },
  );

  const { result } = renderHook(() => useElementWidth({ current: null }));

  expect(result.current).toBeUndefined();
  expect(observe).not.toHaveBeenCalled();
});
