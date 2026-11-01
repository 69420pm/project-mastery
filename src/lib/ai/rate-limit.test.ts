import { RetryError } from "ai";
import { describe, expect, test } from "vitest";
import { gatewayRateLimitWaitMs } from "@/lib/ai/rate-limit";

const rateLimit = (message: string) =>
  Object.assign(new Error(message), { name: "GatewayRateLimitError" });

describe("gatewayRateLimitWaitMs", () => {
  test("reads the wait the message names", () => {
    expect(
      gatewayRateLimitWaitMs(rateLimit("Too many. Retry after 20s.")),
    ).toBe(20_000);
  });

  test("waits a minute when the message names none", () => {
    expect(gatewayRateLimitWaitMs(rateLimit("Too many."))).toBe(60_000);
  });

  test("finds the error inside the AI SDK's retry error", () => {
    const error = new RetryError({
      message: "Failed after 3 attempts",
      reason: "maxRetriesExceeded",
      errors: [rateLimit("Retry after 5s.")],
    });
    expect(gatewayRateLimitWaitMs(error)).toBe(5000);
  });

  test("is null for another error", () => {
    expect(gatewayRateLimitWaitMs(new Error("boom"))).toBeNull();
  });
});
