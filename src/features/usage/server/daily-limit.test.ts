// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

const STUDENT = "11111111-1111-1111-1111-111111111111";
const CLASSMATE = "22222222-2222-2222-2222-222222222222";

let db = fakeSupabase({ tables: { ai_usage: [] as FakeRow[] } });

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));

const { getDailyLimitStatus } = await import("./daily-limit");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T15:30:00.000Z"));
});

/** The Student's Daily limit status with these usage records stored. */
function statusWith(records: FakeRow[]) {
  db = fakeSupabase({
    tables: { ai_usage: records },
    // Row Level Security: a Student reads only their own records.
    canAccess: (_table, row) => row.owner === STUDENT,
  });
  return getDailyLimitStatus();
}

function spent(costUsd: number, createdAt = "2026-10-08T09:00:00.000Z") {
  return { owner: STUDENT, cost_usd: costUsd, created_at: createdAt };
}

describe("the Daily limit", () => {
  test("is open below 80% of the limit", async () => {
    vi.stubEnv("AI_DAILY_LIMIT_USD", "1");

    const status = await statusWith([spent(0.5), spent(0.29)]);

    expect(status).toEqual({
      level: "ok",
      resetsAt: "2026-10-09T00:00:00.000Z",
    });
  });

  test("warns from 80% of the limit", async () => {
    vi.stubEnv("AI_DAILY_LIMIT_USD", "1");

    const status = await statusWith([spent(0.5), spent(0.3)]);

    expect(status.level).toBe("warning");
  });

  test("is reached at 100% of the limit", async () => {
    vi.stubEnv("AI_DAILY_LIMIT_USD", "1");

    const status = await statusWith([spent(0.6), spent(0.4)]);

    expect(status.level).toBe("reached");
  });

  test("counts only today's spend since 00:00 UTC", async () => {
    vi.stubEnv("AI_DAILY_LIMIT_USD", "1");

    const status = await statusWith([
      spent(5, "2026-10-07T23:59:59.999Z"),
      spent(0.1, "2026-10-08T00:00:00.000Z"),
    ]);

    expect(status.level).toBe("ok");
  });

  test("counts only the Student's own spend", async () => {
    vi.stubEnv("AI_DAILY_LIMIT_USD", "1");

    const status = await statusWith([{ ...spent(5), owner: CLASSMATE }]);

    expect(status.level).toBe("ok");
  });

  test("never blocks without AI_DAILY_LIMIT_USD", async () => {
    vi.stubEnv("AI_DAILY_LIMIT_USD", "");

    const status = await statusWith([spent(1_000_000)]);

    expect(status.level).toBe("ok");
  });

  test("is reached from the start with a limit of 0", async () => {
    vi.stubEnv("AI_DAILY_LIMIT_USD", "0");

    const status = await statusWith([]);

    expect(status.level).toBe("reached");
  });

  test("refuses an invalid AI_DAILY_LIMIT_USD", async () => {
    vi.stubEnv("AI_DAILY_LIMIT_USD", "five dollars");

    await expect(statusWith([])).rejects.toThrow(/AI_DAILY_LIMIT_USD/);
  });
});
