// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

/**
 * Deleting a Material removes the pairs of its exercises and solutions (the
 * foreign keys cascade, tested with pgTAP), so the Course's pairing runs
 * again.
 */

const STUDENT = "11111111-1111-1111-1111-111111111111";
const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const MATERIAL = "aaaaaaaa-0000-4000-8000-000000000001";
const PATH = `${STUDENT}/${COURSE}/${MATERIAL}`;

let db = createDb();

function createDb() {
  const fake = fakeSupabase({
    tables: {
      courses: [{ id: COURSE, owner: STUDENT, name: "Calculus" }] as FakeRow[],
      materials: [
        {
          id: MATERIAL,
          owner: STUDENT,
          course_id: COURSE,
          name: "Solutions 7",
          media_type: "application/pdf",
          storage_path: PATH,
        },
      ] as FakeRow[],
    },
    userId: STUDENT,
  });
  fake.files.seed("course-files", PATH, { body: "%PDF-1.7" });
  return fake;
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/user", () => ({
  getUser: async () => ({ id: STUDENT, email: undefined }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));
// Workflows started by the actions, as Vercel Workflow's start() receives them.
const startWorkflow = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("workflow/api", () => ({ start: startWorkflow }));

const { pairCourse } = await import("@/features/ingestion/server");
const { deleteMaterial } = await import("./actions");

beforeEach(() => {
  db = createDb();
  startWorkflow.mockReset();
});

describe("deleteMaterial and pairing", () => {
  test("pairs the Course's exercises again, without the deleted ones", async () => {
    await deleteMaterial({ materialId: MATERIAL });

    expect(startWorkflow).toHaveBeenCalledExactlyOnceWith(pairCourse, [COURSE]);
  });

  test("is still done when pairing cannot start", async () => {
    startWorkflow.mockRejectedValueOnce(new Error("queue down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await deleteMaterial({ materialId: MATERIAL });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(db.tables.materials).toEqual([]);
  });
});
