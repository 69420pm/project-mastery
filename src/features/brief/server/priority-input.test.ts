// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";
import type { AdminSupabase } from "@/lib/supabase/types";
import { loadBriefForPriorities } from "./priority-input";

vi.mock("server-only", () => ({}));

const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const OTHER_COURSE = "aaaaaaaa-c000-4000-8000-000000000002";

function createDb(briefs: FakeRow[] = []) {
  return fakeSupabase({
    tables: {
      briefs,
      brief_excluded_materials: [
        { course_id: COURSE, material_id: "m1" },
        { course_id: COURSE, material_id: "m2" },
        { course_id: OTHER_COURSE, material_id: "m3" },
      ] as FakeRow[],
    },
  });
}

/** `db` as the admin client, with reads of `failing` failing. */
function admin(db: ReturnType<typeof createDb>, failing?: string) {
  return {
    ...db,
    from(table: Parameters<typeof db.from>[0]) {
      const builder = db.from(table);
      if (table === failing) {
        builder.then = (resolve, reject) =>
          Promise.resolve({ data: null, error: { code: "", message: "boom" } })
            .then(resolve)
            .catch(reject);
      }
      return builder;
    },
  } as unknown as AdminSupabase;
}

describe("loadBriefForPriorities", () => {
  test("without a Brief, has no notes", async () => {
    expect(await loadBriefForPriorities(admin(createDb()), COURSE)).toEqual({
      notes: null,
      notesUpdatedAt: null,
      excludedMaterialIds: ["m1", "m2"],
    });
  });

  test("maps the Course's notes and excluded Materials", async () => {
    const db = createDb([
      { course_id: OTHER_COURSE, notes: "Other", notes_updated_at: "x" },
      {
        course_id: COURSE,
        notes: "Skip chapter 4.",
        notes_updated_at: "2026-10-05T12:00:00Z",
      },
    ]);

    expect(await loadBriefForPriorities(admin(db), COURSE)).toEqual({
      notes: "Skip chapter 4.",
      notesUpdatedAt: "2026-10-05T12:00:00Z",
      excludedMaterialIds: ["m1", "m2"],
    });
  });

  test.each([
    ["briefs", "Loading the Brief failed: boom"],
    ["brief_excluded_materials", "Loading the excluded Materials failed: boom"],
  ])("throws when reading %s fails", async (table, message) => {
    await expect(
      loadBriefForPriorities(admin(createDb(), table), COURSE),
    ).rejects.toThrow(message);
  });
});
