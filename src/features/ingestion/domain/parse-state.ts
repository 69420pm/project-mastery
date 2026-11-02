import {
  PARSE_LEASE_MINUTES,
  parseStoppedReason,
} from "@/features/ingestion/domain/parse-failure";
import type { ParseStatus } from "@/features/ingestion/types";

/** A Material's parse state, as the Materials page reads it. */
export type ParseState = {
  status: ParseStatus;
  pagesDone: number;
  pagesTotal: number | null;
  failure: string | null;
  /**
   * The Material is `queued`, but starting its workflow failed, so no parse
   * will pick it up until the Student starts one.
   */
  startFailed: boolean;
  /** The pages whose page call failed, in order; shown once parsed. */
  unreadablePages: number[];
};

/**
 * The state the Student sees: a queued or parsing Material without a
 * heartbeat for PARSE_LEASE_MINUTES has stopped, so it shows failed, as
 * `public.queue_material_parse` treats it.
 */
export function withLease(
  state: ParseState,
  heartbeatAt: string,
  now: number = Date.now(),
): ParseState {
  const stale = now - Date.parse(heartbeatAt) > PARSE_LEASE_MINUTES * 60_000;
  return stale && (state.status === "queued" || state.status === "parsing")
    ? { ...state, status: "failed", failure: parseStoppedReason }
    : state;
}

/**
 * Whether the Student may start the Material's parse: Parse when it was
 * never parsed or its workflow did not start, Retry when it failed. The
 * same rule guards `public.queue_material_parse`.
 */
export function canStartParse({
  status,
  startFailed,
}: Pick<ParseState, "status" | "startFailed">): boolean {
  return (
    status === "not_parsed" ||
    status === "failed" ||
    (status === "queued" && startFailed)
  );
}

/** What the Student sees of a parse state: "Waiting", "Parsing 2/5", … */
export function parseStateLabel({
  status,
  pagesDone,
  pagesTotal,
  startFailed,
}: ParseState): string {
  switch (status) {
    case "not_parsed":
      return "Not parsed";
    case "queued":
      return startFailed ? "Not started" : "Waiting";
    case "parsing":
      return pagesTotal === null
        ? "Parsing"
        : `Parsing ${pagesDone}/${pagesTotal}`;
    case "parsed":
      return "Parsed";
    case "failed":
      return "Failed";
  }
}

/** Whether a parse is still to finish, so its page keeps refreshing. */
export function isParseRunning({
  status,
  startFailed,
}: Pick<ParseState, "status" | "startFailed">) {
  return (status === "queued" && !startFailed) || status === "parsing";
}
