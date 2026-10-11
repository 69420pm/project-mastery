import type { ParseStatus } from "@/features/ingestion/types";

/** A Material's parse state, as the Materials page reads it. */
export type ParseState = {
  status: ParseStatus;
  pagesDone: number;
  pagesTotal: number | null;
  failure: string | null;
};

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
