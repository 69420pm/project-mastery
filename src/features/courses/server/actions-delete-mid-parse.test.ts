// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

/**
 * Deleting a Material or Course while its parse runs: the workflow may store
 * page images or figure crops after the delete removed the files, but before
 * it removed the rows. Nothing may stay behind.
 */

const STUDENT = "11111111-1111-1111-1111-111111111111";
const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const MATERIAL = "aaaaaaaa-0000-4000-8000-000000000001";
const PATH = `${STUDENT}/${COURSE}/${MATERIAL}`;
const BUCKET = "course-files";

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
          name: "Lecture 1",
          media_type: "application/pdf",
          storage_path: PATH,
        },
      ] as FakeRow[],
    },
    userId: STUDENT,
  });
  fake.files.seed(BUCKET, PATH, { body: "%PDF-1.7" });
  fake.files.seed(BUCKET, `${PATH}/pages/1.png`, { body: "png" });
  return fake;
}

/**
 * The running parse stores another page image and figure crop right after
 * the delete's first removal of the files, while the rows still exist.
 */
function storeDuringFirstRemoval() {
  const from = db.storage.from;
  let stored = false;
  db.storage.from = (bucket: string) => {
    const store = from(bucket);
    return {
      ...store,
      remove: async (paths: string[]) => {
        const result = await store.remove(paths);
        if (!stored) {
          stored = true;
          db.files.seed(BUCKET, `${PATH}/pages/2.png`, { body: "png" });
          db.files.seed(BUCKET, `${PATH}/figures/2-0.png`, { body: "png" });
        }
        return result;
      },
    };
  };
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/user", () => ({
  getUser: async () => ({ id: STUDENT, email: undefined }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));
vi.mock("workflow/api", () => ({ start: vi.fn() }));

const { deleteCourse, deleteMaterial } = await import("./actions");

beforeEach(() => {
  db = createDb();
});

describe("deleting while the parse stores files", () => {
  test("deleteMaterial leaves no files behind", async () => {
    storeDuringFirstRemoval();

    const result = await deleteMaterial({ materialId: MATERIAL });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(db.tables.materials).toEqual([]);
    expect(db.files.paths(BUCKET)).toEqual([]);
  });

  test("deleteCourse leaves no files behind", async () => {
    storeDuringFirstRemoval();

    const result = await deleteCourse({ courseId: COURSE });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(db.tables.courses).toEqual([]);
    expect(db.files.paths(BUCKET)).toEqual([]);
  });
});
