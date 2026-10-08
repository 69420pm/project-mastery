// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  costUsd,
  dailyLimitReset,
  estimatedUsage,
  tokenUsage,
  utcDayStart,
} from "./cost";

describe("costUsd", () => {
  test("prices input, cached input and output tokens per million", () => {
    // Gemini 2.5 Flash: $0.30 input, $0.03 cached input, $2.50 output.
    // 600k × 0.30 + 400k × 0.03 + 100k × 2.50 = 0.18 + 0.012 + 0.25
    const cost = costUsd("google/gemini-2.5-flash", {
      inputTokens: 1_000_000,
      cachedInputTokens: 400_000,
      outputTokens: 100_000,
    });

    expect(cost).toBeCloseTo(0.442, 10);
  });

  test("a call without cached tokens costs input plus output", () => {
    // Gemini 2.5 Pro: 2,000 × $1.25 + 500 × $10 per million.
    const cost = costUsd("google/gemini-2.5-pro", {
      inputTokens: 2_000,
      cachedInputTokens: 0,
      outputTokens: 500,
    });

    expect(cost).toBeCloseTo(0.0075, 10);
  });

  test("refuses a model without a price", () => {
    expect(() =>
      costUsd("acme/unpriced", {
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
      }),
    ).toThrow(/acme\/unpriced/);
  });
});

describe("tokenUsage", () => {
  test("reads the token counts from AI SDK usage", () => {
    expect(
      tokenUsage({
        inputTokens: 120,
        inputTokenDetails: {
          noCacheTokens: 20,
          cacheReadTokens: 100,
          cacheWriteTokens: undefined,
        },
        outputTokens: 30,
      }),
    ).toEqual({ inputTokens: 120, cachedInputTokens: 100, outputTokens: 30 });
  });

  test("counts missing values as zero", () => {
    expect(
      tokenUsage({
        inputTokens: undefined,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokens: undefined,
      }),
    ).toEqual({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });
  });
});

describe("estimatedUsage", () => {
  test("estimates an aborted call at about four characters per token", () => {
    expect(
      estimatedUsage({ input: "a".repeat(4_000), output: "b".repeat(400) }),
    ).toEqual({ inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 100 });
  });

  test("rounds a partial token up", () => {
    expect(estimatedUsage({ input: "hello", output: "" })).toEqual({
      inputTokens: 2,
      cachedInputTokens: 0,
      outputTokens: 0,
    });
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
