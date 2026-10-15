import { APICallError, RetryError } from "ai";
import { describe, expect, test } from "vitest";
import { isDailyQuotaError } from "./daily-quota";

/** A 429 from the Gemini API for the quota `quotaId` (see docs/agents/live-ai.md). */
function quota429(quotaId: string) {
  return new APICallError({
    message: "You exceeded your current quota",
    url: "https://example.test",
    requestBodyValues: {},
    statusCode: 429,
    responseBody: JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [{ quotaId, quotaValue: "20" }],
          },
        ],
      },
    }),
  });
}

describe("isDailyQuotaError", () => {
  test("is true for a 429 of the requests-per-day quota", () => {
    expect(
      isDailyQuotaError(
        quota429("GenerateRequestsPerDayPerProjectPerModel-FreeTier"),
      ),
    ).toBe(true);
  });

  test("is true for that 429 after the SDK's retries", () => {
    const daily = quota429("GenerateRequestsPerDayPerProjectPerModel-FreeTier");
    const retried = new RetryError({
      message: "Failed after 3 attempts",
      reason: "maxRetriesExceeded",
      errors: [daily, daily],
    });

    expect(isDailyQuotaError(retried)).toBe(true);
  });

  test("is false for a per-minute 429, which waiting clears", () => {
    expect(
      isDailyQuotaError(
        quota429("GenerateRequestsPerMinutePerProjectPerModel-FreeTier"),
      ),
    ).toBe(false);
  });

  test("is false for other errors", () => {
    expect(isDailyQuotaError(new Error("bad output"))).toBe(false);
  });
});
