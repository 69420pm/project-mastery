import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/features/knowledge-map/domain/encodings";
import { useSavedSettings } from "./use-saved-settings";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

/** Hides the Exercises layer in a first view of the map, then closes it. */
function toggleExercisesOff() {
  const first = renderHook(() => useSavedSettings());
  const [settings, save] = first.result.current;
  act(() =>
    save({ ...settings, layers: { ...settings.layers, exercises: false } }),
  );
  expect(first.result.current[0].layers.exercises).toBe(false);
  first.unmount();
}

test("a toggled layer is restored in the next view of the map", () => {
  toggleExercisesOff();

  const { result } = renderHook(() => useSavedSettings());
  expect(result.current[0]).toEqual({
    ...DEFAULT_SETTINGS,
    layers: { ...DEFAULT_SETTINGS.layers, exercises: false },
  });
});

test("a toggled layer lasts while the page is open when storage can't be written", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("QuotaExceededError");
  });
  toggleExercisesOff();

  const { result } = renderHook(() => useSavedSettings());
  expect(result.current[0].layers.exercises).toBe(false);
});
