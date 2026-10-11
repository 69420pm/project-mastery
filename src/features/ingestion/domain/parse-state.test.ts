import { describe, expect, test } from "vitest";
import { canStartParse, type ParseState } from "./parse-state";

const now = new Date("2026-10-11T12:00:00.000Z");

const state = (
  status: ParseState["status"],
  updatedAt = "2026-10-11T11:59:00.000Z",
): ParseState => ({
  status,
  pagesDone: 0,
  pagesTotal: null,
  failure: null,
  updatedAt,
});

describe("canStartParse", () => {
  test.each(["not_parsed", "failed"] as const)(
    "is true for a %s Material",
    (status) => {
      expect(canStartParse(state(status), now)).toBe(true);
    },
  );

  test.each(["parsing", "parsed"] as const)(
    "is false for a %s Material",
    (status) => {
      expect(
        canStartParse(state(status, "2026-10-01T00:00:00.000Z"), now),
      ).toBe(false);
    },
  );

  test("is false for a Material that waits less than 5 minutes for its parse", () => {
    expect(
      canStartParse(state("queued", "2026-10-11T11:55:01.000Z"), now),
    ).toBe(false);
  });

  test("is true for a Material that waited 5 minutes without its parse starting", () => {
    expect(
      canStartParse(state("queued", "2026-10-11T11:54:59.000Z"), now),
    ).toBe(true);
  });
});
