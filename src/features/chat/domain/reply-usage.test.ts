import { describe, expect, test } from "vitest";
import {
  costText,
  replyUsage,
  tokenCount,
  tokensText,
} from "@/features/chat/domain/reply-usage";

test.each([
  [0, "0"],
  [999, "999"],
  [1_000, "1k"],
  [1_050, "1.1k"],
  [999_000, "999k"],
  [1_000_000, "1M"],
  [1_050_000, "1.1M"],
])("tokenCount(%i) is %s", (count, text) => {
  expect(tokenCount(count)).toBe(text);
});

test.each([
  [0.00009, "<$0.0001"],
  [0.0001, "$0.0001"],
  [0.00994, "$0.0099"],
  [0.01, "$0.01"],
  [0.015, "$0.01"],
  [12.3, "$12.30"],
])("costText(%f) is %s", (cost, text) => {
  expect(costText(cost)).toBe(text);
});

describe("reply usage text", () => {
  test("shows tokens with the cached part", () => {
    const usage = {
      inputTokens: 12_345,
      cachedInputTokens: 8_100,
      outputTokens: 640,
      costUsd: 0.0012,
      estimated: false,
    };
    expect(tokensText(usage)).toBe("in 12.3k (8.1k cached) · out 640");
    expect(tokensText({ ...usage, cachedInputTokens: 0 })).toBe(
      "in 12.3k · out 640",
    );
  });

  test("shows cost to four decimals while it is small", () => {
    expect(costText(0.0012)).toBe("$0.0012");
    expect(costText(0.5)).toBe("$0.50");
    expect(costText(0)).toBe("$0");
    expect(costText(0.00001)).toBe("<$0.0001");
  });

  test("prices usage with the model", () => {
    const usage = replyUsage(
      "google/gemini-3.5-flash-lite",
      { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0 },
      true,
    );
    expect(usage.estimated).toBe(true);
    expect(usage.costUsd).toBeCloseTo(0.3, 6);
  });
});
