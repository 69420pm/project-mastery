import { describe, expect, test } from "vitest";
import {
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
