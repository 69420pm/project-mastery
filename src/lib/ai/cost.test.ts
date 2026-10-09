// @vitest-environment node
import { describe, expect, test } from "vitest";
import { costUsd, estimatedUsage, tokenUsage } from "./cost";

describe("costUsd", () => {
  test("prices input, cached input and output tokens per million", () => {
    // Gemini 3.5 Flash-Lite: $0.30 input, $0.03 cached input, $2.50 output.
    // 600k × 0.30 + 400k × 0.03 + 100k × 2.50 = 0.18 + 0.012 + 0.25
    const cost = costUsd("google/gemini-3.5-flash-lite", {
      inputTokens: 1_000_000,
      cachedInputTokens: 400_000,
      outputTokens: 100_000,
    });

    expect(cost).toBeCloseTo(0.442, 10);
  });

  test("a call without cached tokens costs input plus output", () => {
    // Gemini 3.8 Flash: 2,000 × $0.75 + 500 × $3.75 per million.
    const cost = costUsd("google/gemini-3.8-flash", {
      inputTokens: 2_000,
      cachedInputTokens: 0,
      outputTokens: 500,
    });

    expect(cost).toBeCloseTo(0.003375, 10);
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

  test("counts about 260 tokens per PDF page, at about 50 KB per page", () => {
    const usage = estimatedUsage({
      input: "",
      output: "",
      files: [
        { mediaType: "application/pdf", sizeBytes: 500_000 },
        // A tiny PDF still has a page.
        { mediaType: "application/pdf", sizeBytes: 1_000 },
      ],
    });

    expect(usage.inputTokens).toBe(10 * 260 + 260);
  });

  test("counts a fixed 1,120 tokens per image, whatever its size", () => {
    const usage = estimatedUsage({
      input: "abcd",
      output: "",
      files: [
        { mediaType: "image/png", sizeBytes: 3_000_000 },
        { mediaType: "image/jpeg", sizeBytes: 20_000 },
      ],
    });

    expect(usage.inputTokens).toBe(1 + 2 * 1_120);
  });

  test("rounds a partial token up", () => {
    expect(estimatedUsage({ input: "hello", output: "" })).toEqual({
      inputTokens: 2,
      cachedInputTokens: 0,
      outputTokens: 0,
    });
  });
});
