// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

/**
 * The map page's priority reads and lazy start, on the Student's session
 * client: `queue_priority_run` and `record_priority_run_start_failure`
 * stand in for the database functions, which pgTAP tests.
 */

const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";

let signedIn = true;
let queued = true;
let db = createDb();
const start = vi.fn<(...args: unknown[]) => Promise<unknown>>();

function createDb() {
  return fakeSupabase({
    tables: {
      priority_runs: [] as FakeRow[],
      kc_priorities: [] as FakeRow[],
      calls: [] as FakeRow[],
    },
    // PostgREST's row limit, as supabase/config.toml sets it.
    maxRows: 1000,
    functions: {
      queue_priority_run: (args, tables) => {
        tables.calls.push({ name: "queue", ...args });
        return queued;
      },
      record_priority_run_start_failure: (args, tables) => {
        tables.calls.push({ name: "record", ...args });
        return true;
      },
    },
  });
}

vi.mock("server-only", () => ({}));
vi.mock("workflow/api", () => ({
  start: (...args: unknown[]) => start(...args),
}));
vi.mock("@/features/priorities/workflows/update-priorities", () => ({
  updatePriorities: "updatePriorities",
}));
vi.mock("@/lib/auth/user", () => ({
  getUser: async () => (signedIn ? { id: "student" } : null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));

const { ensurePriorities, getPriorities, loadKcPriorities } =
  await import("./priorities");

beforeEach(() => {
  signedIn = true;
  queued = true;
  db = createDb();
  start.mockReset();
  start.mockResolvedValue({});
});

describe("ensurePriorities", () => {
  test.each([
    ["signed out", COURSE, false],
    ["a non-uuid id", "not-a-uuid", true],
  ])("does nothing when %s", async (_, courseId, user) => {
    signedIn = user;
    await ensurePriorities(courseId);
    expect(db.tables.calls).toEqual([]);
    expect(start).not.toHaveBeenCalled();
  });

  test("starts the workflow for a queued run", async () => {
    await ensurePriorities(COURSE);
    expect(start).toHaveBeenCalledWith("updatePriorities", [COURSE]);
    expect(db.tables.calls).toEqual([{ name: "queue", course_id: COURSE }]);
  });

  test("starts nothing when no run was queued", async () => {
    queued = false;
    await ensurePriorities(COURSE);
    expect(start).not.toHaveBeenCalled();
  });

  test("records a failed start instead of throwing", async () => {
    start.mockRejectedValue(new Error("Workflow is down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(ensurePriorities(COURSE)).resolves.toBeUndefined();
    expect(db.tables.calls).toEqual([
      { name: "queue", course_id: COURSE },
      { name: "record", course_id: COURSE },
    ]);
  });
});

describe("getPriorities", () => {
  const none = { running: false, failureReason: null, kcs: {} };

  test.each([
    ["signed out", COURSE, false],
    ["a non-uuid id", "not-a-uuid", true],
  ])("reads as never run when %s", async (_, courseId, user) => {
    signedIn = user;
    db.tables.priority_runs.push({ course_id: COURSE, status: "running" });
    expect(await getPriorities(courseId)).toEqual(none);
  });

  test("reads as never run before the first run", async () => {
    expect(await getPriorities(COURSE)).toEqual(none);
  });

  test.each([
    ["running", null, true, null],
    [
      "failed",
      "The priorities could not be computed.",
      false,
      "The priorities could not be computed.",
    ],
    ["done", null, false, null],
  ])(
    "a %s run gives its running state and failure reason",
    async (status, failure_reason, running, failureReason) => {
      db.tables.priority_runs.push({
        course_id: COURSE,
        status,
        failure_reason,
      });
      expect(await getPriorities(COURSE)).toMatchObject({
        running,
        failureReason,
      });
    },
  );

  test("gives each KC its level, value, multiplier and reasons", async () => {
    const row = (kc_id: string, priority: string, multiplier = "1") => ({
      course_id: COURSE,
      kc_id,
      priority,
      multiplier,
      reasons: [`Reason ${kc_id}`],
    });
    db.tables.priority_runs.push({ course_id: COURSE, status: "done" });
    db.tables.kc_priorities.push(
      row("a", "0.9"),
      row("b", "0.6"),
      row("c", "0.3"),
      row("unused", "0"),
      row("skipped", "0", "0"),
      {
        ...row("other", "1"),
        course_id: "aaaaaaaa-c000-4000-8000-000000000002",
      },
    );

    const { kcs } = await getPriorities(COURSE);

    expect(
      Object.fromEntries(Object.entries(kcs).map(([id, kc]) => [id, kc.level])),
    ).toEqual({
      a: "high",
      b: "medium",
      c: "low",
      unused: "low",
      skipped: "excluded",
    });
    expect(kcs.a).toEqual({
      level: "high",
      value: 0.9,
      multiplier: 1,
      reasons: ["Reason a"],
    });
  });

  test("reads every KC of a Course past the row limit", async () => {
    db.tables.kc_priorities.push(
      ...Array.from({ length: 1500 }, (_, i) => ({
        course_id: COURSE,
        kc_id: `kc-${String(i).padStart(4, "0")}`,
        priority: String(i / 1500),
        multiplier: "1",
        reasons: [],
      })),
    );

    const { kcs } = await getPriorities(COURSE);
    const stored = await loadKcPriorities(
      db as unknown as Parameters<typeof loadKcPriorities>[0],
      COURSE,
    );

    expect(Object.keys(kcs)).toHaveLength(1500);
    expect(kcs["kc-1499"]?.level).toBe("high");
    expect(Object.keys(stored)).toHaveLength(1500);
    expect(stored["kc-1499"]).toBeCloseTo(1499 / 1500);
  });
});
