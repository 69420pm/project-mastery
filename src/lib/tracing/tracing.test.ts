// @vitest-environment node
import { afterEach, describe, expect, test, vi } from "vitest";
import { isLangfuseConfigured, isTracingEnabled } from "./env";
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

describe("isTracingEnabled", () => {
  test("is true with keys and a real provider", () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-lf-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-lf-test");
    vi.stubEnv("AI_PROVIDER", "gateway");

    expect(isTracingEnabled()).toBe(true);
  });

  test("is false for the mock provider, even with keys", () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-lf-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-lf-test");
    vi.stubEnv("AI_PROVIDER", "mock");

    expect(isTracingEnabled()).toBe(false);
  });

  test("is false without keys", () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "");
    vi.stubEnv("AI_PROVIDER", "gateway");

    expect(isTracingEnabled()).toBe(false);
  });

  test("treats an empty LANGFUSE_BASE_URL as unset", () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-lf-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-lf-test");
    vi.stubEnv("LANGFUSE_BASE_URL", "");
    vi.stubEnv("AI_PROVIDER", "gateway");

    expect(isTracingEnabled()).toBe(true);
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
