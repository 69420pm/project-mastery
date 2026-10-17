"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  type MapSettings,
  parseSettings,
} from "@/features/knowledge-map/domain/encodings";

const KEY = "knowledge-map-settings";

const listeners = new Set<() => void>();
/** What was set while `localStorage` was unavailable; undefined before. */
let memory: string | null | undefined;

function read(): string | null {
  if (memory !== undefined) return memory;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * The graph's toggles and encodings, kept in `localStorage`: the defaults on
 * the server and for a missing, invalid or unreadable value. The first
 * render matches the server's, then the saved values apply. Where storage
 * can't be written, the settings last until the page closes.
 */
export function useSavedSettings(): [MapSettings, (s: MapSettings) => void] {
  const saved = useSyncExternalStore(subscribe, read, () => null);
  const settings = useMemo(() => parseSettings(saved), [saved]);
  const save = useCallback((next: MapSettings) => {
    const text = JSON.stringify(next);
    try {
      localStorage.setItem(KEY, text);
      memory = undefined;
    } catch {
      memory = text;
    }
    for (const listener of listeners) listener();
  }, []);
  return [settings, save];
}
