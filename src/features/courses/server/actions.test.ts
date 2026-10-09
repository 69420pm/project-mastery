// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase } from "@/lib/supabase/testing";

const STUDENT = "11111111-1111-1111-1111-111111111111";
const CLASSMATE = "22222222-2222-2222-2222-222222222222";

let signedIn: string | null = STUDENT;
let db = createDb();

/** The local tables, with the ownership rules of the real policies. */
function createDb() {
  return fakeSupabase({
    tables: { courses: [] },
    defaults: { courses: () => ({ owner: signedIn }) },
    canAccess: (_table, row) => row.owner === signedIn,
  });
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/user", () => ({
  getUser: async () => (signedIn ? { id: signedIn, email: undefined } : null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));

const { createCourse, deleteCourse, renameCourse } = await import("./actions");

beforeEach(() => {
  signedIn = STUDENT;
  db = createDb();
});

describe("createCourse", () => {
  test("stores a Course with the trimmed name, owned by the Student", async () => {
    const result = await createCourse({ name: "  Linear Algebra " });

    expect(result).toEqual({ ok: true, data: { id: expect.any(String) } });
    expect(db.tables.courses).toEqual([
      expect.objectContaining({
        id: result.ok && result.data.id,
        owner: STUDENT,
        name: "Linear Algebra",
      }),
    ]);
  });

  test.each([
    ["an empty name", "   ", "Enter a name."],
    [
      "a name over 100 characters",
      "x".repeat(101),
      "Keep the name to 100 characters or fewer.",
    ],
  ])("refuses %s and stores nothing", async (_case, name, message) => {
    const result = await createCourse({ name });

    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { name: [message] },
    });
    expect(db.tables.courses).toEqual([]);
  });

  test("accepts a name of exactly 100 characters", async () => {
    const result = await createCourse({ name: "x".repeat(100) });

    expect(result.ok).toBe(true);
  });

  test("allows two Courses with the same name", async () => {
    await createCourse({ name: "Analysis" });
    const second = await createCourse({ name: "Analysis" });

    expect(second.ok).toBe(true);
    expect(db.tables.courses.map((course) => course.name)).toEqual([
      "Analysis",
      "Analysis",
    ]);
  });

  test("refuses a signed-out visitor", async () => {
    signedIn = null;

    const result = await createCourse({ name: "Analysis" });

    expect(result).toEqual({
      ok: false,
      message: "Sign in again to continue.",
    });
    expect(db.tables.courses).toEqual([]);
  });
});

/** Stores a Course as if `owner` had created it, and returns its id. */
function seedCourse(owner: string, name: string): string {
  const id = randomUUID();
  db.tables.courses.push({
    id,
    owner,
    name,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
  return id;
}

const nameOf = (courseId: string) =>
  db.tables.courses.find((course) => course.id === courseId)?.name;

describe("renameCourse", () => {
  test("renames the Student's Course to the trimmed name", async () => {
    const courseId = seedCourse(STUDENT, "Lin Alg");

    const result = await renameCourse({ courseId, name: " Linear Algebra " });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(nameOf(courseId)).toBe("Linear Algebra");
  });

  test("refuses an invalid name with the same message as creating", async () => {
    const courseId = seedCourse(STUDENT, "Lin Alg");

    const result = await renameCourse({ courseId, name: "" });

    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { name: ["Enter a name."] },
    });
    expect(nameOf(courseId)).toBe("Lin Alg");
  });

  test("never renames another Student's Course", async () => {
    const courseId = seedCourse(CLASSMATE, "Thermodynamics");

    const result = await renameCourse({ courseId, name: "Hijacked" });

    expect(result).toEqual({
      ok: false,
      message: "This course does not exist.",
    });
    expect(nameOf(courseId)).toBe("Thermodynamics");
  });
});

describe("deleteCourse", () => {
  test("deletes the Student's Course", async () => {
    const courseId = seedCourse(STUDENT, "Analysis");
    const kept = seedCourse(STUDENT, "Statistics");

    const result = await deleteCourse({ courseId });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(db.tables.courses.map((course) => course.id)).toEqual([kept]);
  });

  test("never deletes another Student's Course", async () => {
    const courseId = seedCourse(CLASSMATE, "Thermodynamics");

    const result = await deleteCourse({ courseId });

    expect(result).toEqual({
      ok: false,
      message: "This course does not exist.",
    });
    expect(nameOf(courseId)).toBe("Thermodynamics");
  });
});
