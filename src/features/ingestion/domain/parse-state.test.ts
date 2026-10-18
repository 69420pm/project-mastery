import { describe, expect, test } from "vitest";
import {
  canStartParse,
  isParseRunning,
  parseStateLabel,
  type ParseState,
} from "./parse-state";

const state = (
  status: ParseState["status"],
  startFailed = false,
): ParseState => ({
  status,
  pagesDone: 0,
  pagesTotal: null,
  failure: null,
  startFailed,
});

describe("canStartParse", () => {
  test.each(["not_parsed", "failed"] as const)(
    "is true for a %s Material",
    (status) => {
      expect(canStartParse(state(status))).toBe(true);
    },
  );

  test.each(["queued", "parsing", "parsed"] as const)(
    "is false for a %s Material",
    (status) => {
      expect(canStartParse(state(status))).toBe(false);
    },
  );

  test("is true for a queued Material whose parse could not start", () => {
    expect(canStartParse(state("queued", true))).toBe(true);
  });
});

describe("parseStateLabel", () => {
  test.each([
    [state("not_parsed"), "Not parsed"],
    [state("queued"), "Waiting"],
    [state("queued", true), "Not started"],
    [state("parsing"), "Parsing"],
    [{ ...state("parsing"), pagesDone: 2, pagesTotal: 5 }, "Parsing 2/5"],
    [{ ...state("parsing"), pagesDone: 0, pagesTotal: 3 }, "Parsing 0/3"],
    [state("parsed"), "Parsed"],
    [state("failed"), "Failed"],
  ])("labels %o as %s", (parseState, label) => {
    expect(parseStateLabel(parseState)).toBe(label);
  });
});

describe("a queued Material whose parse could not start", () => {
  test("reads as not started, and the page stops refreshing for it", () => {
    expect(parseStateLabel(state("queued", true))).toBe("Not started");
    expect(isParseRunning(state("queued", true))).toBe(false);
  });
});
