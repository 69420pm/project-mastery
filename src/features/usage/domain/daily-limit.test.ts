// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  dailyLimitReset,
  utcDayStart,
} from "@/features/usage/domain/daily-limit";

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
