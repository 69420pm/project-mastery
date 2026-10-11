// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";
import type { Supabase } from "@/lib/supabase/types";

vi.mock("server-only", () => ({}));
const start = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("workflow/api", () => ({ start }));

const { startParse } = await import("./start-parse");

/**
 * The Student's Materials. `record_parse_start_failure` stands in for the
 * database function, whose guard pgTAP tests.
 */
function createDb() {
  return fakeSupabase({
    tables: {
      materials: [
        { id: "material-1", parse_status: "queued", parse_start_failed: false },
      ] as FakeRow[],
    },
    functions: {
      record_parse_start_failure: ({ material_id }, tables) => {
        const material = tables.materials.find(
          (row) => row.id === material_id && row.parse_status === "queued",
        );
        if (material) material.parse_start_failed = true;
        return Boolean(material);
      },
    },
  });
}

let db = createDb();
beforeEach(() => {
  db = createDb();
  start.mockReset();
});

test("a started parse leaves the Material waiting", async () => {
  start.mockResolvedValueOnce({ runId: "run-1" });

  await startParse(db as unknown as Supabase, "material-1");

  expect(db.tables.materials[0]).toMatchObject({
    parse_status: "queued",
    parse_start_failed: false,
  });
});

test("a parse that cannot start is recorded, so the page offers Parse, and is logged", async () => {
  start.mockRejectedValueOnce(new Error("queue unavailable"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(
    startParse(db as unknown as Supabase, "material-1"),
  ).resolves.toBeUndefined();

  expect(db.tables.materials[0]).toMatchObject({
    parse_status: "queued",
    parse_start_failed: true,
  });
  expect(log).toHaveBeenCalledWith(
    "Starting the parse of a Material failed:",
    expect.objectContaining({ message: "queue unavailable" }),
  );
});
