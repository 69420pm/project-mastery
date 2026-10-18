// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  dailyLimitLevel,
  dailyLimitReset,
  utcDayStart,
} from "@/features/usage/domain/daily-limit";

describe("Daily limit level", () => {
  test.each([
    [0.79, 1, "ok"],
    [0.8, 1, "warning"],
    [0.99, 1, "warning"],
    [1, 1, "reached"],
    [1.5, 1, "reached"],
    [0, 0, "reached"],
    [1000, undefined, "ok"],
  ] as const)("spending %s of %s is %s", (spent, limit, level) => {
    expect(dailyLimitLevel(spent, limit)).toBe(level);
  });
});

describe("Daily limit window", () => {
  test("the day starts at 00:00 UTC", () => {
    expect(utcDayStart(new Date("2026-10-08T23:59:59.999Z"))).toEqual(
      new Date("2026-10-08T00:00:00.000Z"),
    );
    expect(utcDayStart(new Date("2026-10-08T00:00:00.000Z"))).toEqual(
      new Date("2026-10-08T00:00:00.000Z"),
    );
  });

  test("ignores the server's local time zone", () => {
    // 01:30 in Berlin is still the previous day in UTC.
    expect(utcDayStart(new Date("2026-10-09T01:30:00+02:00"))).toEqual(
      new Date("2026-10-08T00:00:00.000Z"),
    );
  });

  test("resets at the next 00:00 UTC", () => {
    expect(dailyLimitReset(new Date("2026-10-08T12:00:00Z"))).toEqual(
      new Date("2026-10-09T00:00:00.000Z"),
    );
    expect(dailyLimitReset(new Date("2026-10-08T00:00:00Z"))).toEqual(
      new Date("2026-10-09T00:00:00.000Z"),
    );
    expect(dailyLimitReset(new Date("2026-12-31T23:59:00Z"))).toEqual(
      new Date("2027-01-01T00:00:00.000Z"),
    );
  });
});
