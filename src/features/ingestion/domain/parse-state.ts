import type { ParseStatus } from "@/features/ingestion/types";

/** A Material's parse state, as the Materials page reads it. */
export type ParseState = {
  status: ParseStatus;
  pagesDone: number;
  pagesTotal: number | null;
  failure: string | null;
  /** When the Material last changed, as an ISO timestamp. */
  updatedAt: string;
};

/**
 * How long a Material waits in `queued` before its parse counts as never
 * started (starting the workflow failed at upload), so Parse is offered
 * again. The workflow moves a Material to `parsing` as it starts. Matches
 * the interval in `public.queue_material_parse`.
 */
export const QUEUED_STALE_MS = 5 * 60 * 1000;

/**
 * Whether the Student may start the Material's parse: Parse when it was
 * never parsed or never started, Retry when it failed.
 */
export function canStartParse(
  { status, updatedAt }: Pick<ParseState, "status" | "updatedAt">,
  now: Date,
): boolean {
  if (status === "not_parsed" || status === "failed") return true;
  return (
    status === "queued" &&
    now.getTime() - new Date(updatedAt).getTime() > QUEUED_STALE_MS
  );
}

/** What the Student sees of a parse state: "Waiting", "Parsing 2/5", … */
export function parseStateLabel({
  status,
  pagesDone,
  pagesTotal,
}: ParseState): string {
  switch (status) {
    case "not_parsed":
      return "Not parsed";
    case "queued":
      return "Waiting";
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
export function isParseRunning({ status }: Pick<ParseState, "status">) {
  return status === "queued" || status === "parsing";
}
