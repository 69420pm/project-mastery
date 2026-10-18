// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { fakeSupabase } from "@/lib/supabase/testing";
import type { Supabase } from "@/lib/supabase/types";

vi.mock("server-only", () => ({}));
const start = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("workflow/api", () => ({ start }));

const { startParse } = await import("./start-parse");

/** Calls of `record_parse_start_failure`; pgTAP tests its real guard. */
const recorded: unknown[] = [];
const db = fakeSupabase({
  tables: {},
  functions: {
    record_parse_start_failure: (args) => {
      recorded.push(args);
      return true;
    },
  },
}) as unknown as Supabase;

beforeEach(() => {
  recorded.length = 0;
  start.mockReset();
});

test("a started parse records no failure", async () => {
  start.mockResolvedValueOnce({ runId: "run-1" });

  await startParse(db, "material-1");

  expect(recorded).toEqual([]);
});

test("a parse that cannot start is recorded and logged, not thrown", async () => {
  start.mockRejectedValueOnce(new Error("queue unavailable"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(startParse(db, "material-1")).resolves.toBeUndefined();

  expect(recorded).toEqual([{ material_id: "material-1" }]);
  expect(log).toHaveBeenCalledWith(
    "Starting the parse of a Material failed:",
    expect.objectContaining({ message: "queue unavailable" }),
  );
});
