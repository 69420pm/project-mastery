// @vitest-environment node
import { afterEach, describe, expect, test, vi } from "vitest";
import { isLangfuseConfigured } from "./env";
import { flushTraces, withTraceAttributes } from "./index";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isLangfuseConfigured", () => {
  test("is false without keys, so tracing stays off", () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
    vi.stubEnv("LANGFUSE_SECRET_KEY", undefined);

    expect(isLangfuseConfigured()).toBe(false);
  });

  test("is true with both keys", () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-lf-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-lf-test");

    expect(isLangfuseConfigured()).toBe(true);
  });

  test("rejects only one of the two keys", () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-lf-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", undefined);

    expect(() => isLangfuseConfigured()).toThrow(/LANGFUSE_SECRET_KEY/);
  });
});

describe("without a registered tracer", () => {
  test("withTraceAttributes just runs the callback", () => {
    expect(withTraceAttributes({ userId: "user-1" }, () => 42)).toBe(42);
  });

  test("flushTraces resolves", async () => {
    await expect(flushTraces()).resolves.toBeUndefined();
  });
});
