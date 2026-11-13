// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase } from "@/lib/supabase/testing";

let signedIn = true;
const db = fakeSupabase({
  tables: {
    ai_usage: [
      { owner: "s", cost_usd: 0.9, created_at: "2026-10-08T09:00:00.000Z" },
    ],
  },
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/user", () => ({
  requireUser: async () => {
    if (!signedIn) throw new Error("NEXT_REDIRECT");
    return { id: "s", email: undefined };
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));

const { loadDailyUsage, refreshDailyLimitStatus } = await import("./actions");

beforeEach(() => {
  signedIn = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T15:30:00.000Z"));
  vi.stubEnv("AI_DAILY_LIMIT_USD", "1");
});

describe("refreshing the Daily limit status", () => {
  test("returns the signed-in Student's status", async () => {
    await expect(refreshDailyLimitStatus()).resolves.toEqual({
      level: "warning",
      resetsAt: "2026-10-09T00:00:00.000Z",
    });
  });

  test("refuses when signed out", async () => {
    signedIn = false;

    await expect(refreshDailyLimitStatus()).rejects.toThrow("NEXT_REDIRECT");
  });

  test("loads today's usage with amounts for Settings", async () => {
    await expect(loadDailyUsage()).resolves.toEqual({
      spentUsd: 0.9,
      limitUsd: 1,
      resetsAt: "2026-10-09T00:00:00.000Z",
    });
    signedIn = false;
    await expect(loadDailyUsage()).rejects.toThrow("NEXT_REDIRECT");
  });
});
