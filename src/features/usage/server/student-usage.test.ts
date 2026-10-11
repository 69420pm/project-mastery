// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";
import type { Supabase } from "@/lib/supabase/types";

vi.mock("server-only", () => ({}));

const { checkDailyLimit, recordAiUsage } =
  await import("@/features/usage/server");

const STUDENT_A = "11111111-1111-1111-1111-111111111111";
const STUDENT_B = "22222222-2222-2222-2222-222222222222";

// The fake stamps rows from 2026-01-01T00:00:00Z on, so "today" is that day.
const NOW = new Date("2026-01-01T12:00:00.000Z");

let rows: FakeRow[];
let admin: Supabase;

beforeEach(() => {
  rows = [];
  // The admin client a workflow has: no session, no Row Level Security.
  admin = fakeSupabase({ tables: { ai_usage: rows } }) as unknown as Supabase;
});

// Google Gemini 3.5 Flash-Lite at $0.30 input and $2.50 output per million
// tokens: 1M input and 200k output cost $0.30 + $0.50 = $0.80.
const PARSE_CALL = {
  task: "ingest",
  modelId: "google/gemini-3.5-flash-lite",
  usage: {
    inputTokens: 1_000_000,
    cachedInputTokens: 0,
    outputTokens: 200_000,
  },
} as const;

describe("usage recorded for an explicit Student id", () => {
  test("is stored for that Student without a Chat", async () => {
    await recordAiUsage(admin, PARSE_CALL, { studentId: STUDENT_A });

    expect(rows).toEqual([
      expect.objectContaining({
        owner: STUDENT_A,
        task: "ingest",
        model_id: "google/gemini-3.5-flash-lite",
        input_tokens: 1_000_000,
        cached_input_tokens: 0,
        output_tokens: 200_000,
        cost_usd: 0.8,
        estimated: false,
        chat_id: null,
      }),
    ]);
  });

  test("counts in that Student's Daily limit and only theirs", async () => {
    vi.stubEnv("AI_DAILY_LIMIT_USD", "1");

    await recordAiUsage(admin, PARSE_CALL, { studentId: STUDENT_A });

    const forA = await checkDailyLimit(admin, {
      studentId: STUDENT_A,
      now: NOW,
    });
    const forB = await checkDailyLimit(admin, {
      studentId: STUDENT_B,
      now: NOW,
    });
    expect(forA).toEqual({
      level: "warning",
      resetsAt: "2026-01-02T00:00:00.000Z",
    });
    expect(forB).toEqual({ level: "ok", resetsAt: "2026-01-02T00:00:00.000Z" });
  });

  test("reaches the Student's Daily limit as their own session would", async () => {
    vi.stubEnv("AI_DAILY_LIMIT_USD", "1");

    await recordAiUsage(admin, PARSE_CALL, { studentId: STUDENT_A });
    await recordAiUsage(admin, PARSE_CALL, { studentId: STUDENT_A });

    // The same rows, read through Student A's session under Row Level Security.
    const session = fakeSupabase({
      tables: { ai_usage: rows },
      canAccess: (_table, row) => row.owner === STUDENT_A,
    }) as unknown as Supabase;
    const viaSession = await checkDailyLimit(session, { now: NOW });
    const viaAdmin = await checkDailyLimit(admin, {
      studentId: STUDENT_A,
      now: NOW,
    });
    expect(viaAdmin.level).toBe("reached");
    expect(viaAdmin).toEqual(viaSession);
  });
});
