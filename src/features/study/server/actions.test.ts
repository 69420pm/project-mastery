// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

const STUDENT = "11111111-1111-1111-1111-111111111111";
const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";

let signedIn: string | null = STUDENT;
let db = createDb();

function createDb() {
  return fakeSupabase({
    tables: { memories: [] as FakeRow[] },
    primaryKeys: { memories: ["course_id"] },
  });
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/user", () => ({
  getUser: async () => (signedIn ? { id: signedIn, email: undefined } : null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));

const { revalidatePath } = await import("next/cache");
const { saveMemory } = await import("./actions");
const { getMemory } = await import("./memory");

beforeEach(() => {
  signedIn = STUDENT;
  db = createDb();
  vi.mocked(revalidatePath).mockClear();
});

describe("saveMemory", () => {
  test("creates the Memory, then replaces it, then clears it", async () => {
    expect(await getMemory(COURSE)).toBe("");

    expect(
      await saveMemory({ courseId: COURSE, text: "Likes examples." }),
    ).toEqual({ ok: true, data: undefined });
    expect(await getMemory(COURSE)).toBe("Likes examples.");

    await saveMemory({ courseId: COURSE, text: "Prefers short answers." });
    await saveMemory({ courseId: COURSE, text: "" });
    expect(db.tables.memories).toMatchObject([{ course_id: COURSE, text: "" }]);
    expect(revalidatePath).toHaveBeenLastCalledWith(`/courses/${COURSE}/brief`);
  });

  test("refuses more than 4,000 characters", async () => {
    const result = await saveMemory({
      courseId: COURSE,
      text: "x".repeat(4001),
    });

    expect(result).toMatchObject({ ok: false });
    expect(db.tables.memories).toEqual([]);
  });

  test("refuses a signed-out caller", async () => {
    signedIn = null;

    expect(await saveMemory({ courseId: COURSE, text: "Hi" })).toMatchObject({
      ok: false,
    });
    expect(db.tables.memories).toEqual([]);
  });
});
