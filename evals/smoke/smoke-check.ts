import type { AdminSupabase } from "@/lib/supabase/types";

/** What a smoke check gets from the runner (`evals/smoke.ts`). */
export type SmokeContext = {
  /** Bypasses Row Level Security: scope every query to `studentId`. */
  supabase: AdminSupabase;
  /** A throwaway Student, deleted with all its data after the check. */
  studentId: string;
  /** The command line arguments after the check's name. */
  args: string[];
};

/** One invariant of the feature path, checked on the real result. */
export type SmokeResult = { name: string; ok: boolean; detail?: string };

/**
 * One real feature path, run once on a small input. A check refuses an input
 * that would take more than the runner's call cap before calling a model.
 */
export type SmokeCheck = {
  name: string;
  usage: string;
  run: (context: SmokeContext) => Promise<SmokeResult[]>;
};

export const result = (
  name: string,
  ok: boolean,
  detail?: string,
): SmokeResult => ({ name, ok, ...(detail ? { detail } : {}) });
