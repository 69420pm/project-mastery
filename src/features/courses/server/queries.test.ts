// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

const STUDENT = "11111111-1111-1111-1111-111111111111";
const CLASSMATE = "22222222-2222-2222-2222-222222222222";

let signedIn: string | null = STUDENT;
let db = createDb();

function createDb() {
  return fakeSupabase({
    tables: { courses: [], materials: [], chats: [] } as Record<
      "courses" | "materials" | "chats",
      FakeRow[]
    >,
    userId: STUDENT,
    foreignKeys: {
      materials: { course_id: "courses" },
      chats: { course_id: "courses" },
    },
    canAccess: (_table, row) => row.owner === signedIn,
  });
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/user", () => ({
  getUser: async () => (signedIn ? { id: signedIn, email: undefined } : null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));

const { getCourse, getCourseList, getMaterials } = await import("./queries");

beforeEach(() => {
  signedIn = STUDENT;
  db = createDb();
});

function seedCourse(owner: string, name: string, updatedAt: string) {
  const id = randomUUID();
  db.tables.courses.push({ id, owner, name, updated_at: updatedAt });
  return id;
}

function seedMaterial(owner: string, courseId: string, name = "Lecture 1") {
  const id = randomUUID();
  db.tables.materials.push({
    id,
    owner,
    course_id: courseId,
    name,
    media_type: "application/pdf",
    size_bytes: 8,
    storage_path: `${owner}/${courseId}/${id}`,
  });
  return id;
}

describe("getCourseList", () => {
  test("lists the Student's Courses, most recently updated first, with their counts", async () => {
    const old = seedCourse(STUDENT, "Analysis", "2026-01-01T00:00:00Z");
    const recent = seedCourse(STUDENT, "Statistics", "2026-03-01T00:00:00Z");
    seedCourse(CLASSMATE, "Thermodynamics", "2026-04-01T00:00:00Z");
    seedMaterial(STUDENT, recent);
    seedMaterial(STUDENT, recent, "Lecture 2");
    db.tables.chats.push({ id: randomUUID(), owner: STUDENT, course_id: old });

    expect(await getCourseList()).toEqual([
      { id: recent, name: "Statistics", chatCount: 0, materialCount: 2 },
      { id: old, name: "Analysis", chatCount: 1, materialCount: 0 },
    ]);
  });

  test("is empty when signed out", async () => {
    seedCourse(STUDENT, "Analysis", "2026-01-01T00:00:00Z");
    signedIn = null;

    expect(await getCourseList()).toEqual([]);
  });
});

describe("getCourse", () => {
  test("finds the Student's Course", async () => {
    const id = seedCourse(STUDENT, "Analysis", "2026-01-01T00:00:00Z");

    // The fake returns whole rows; the real select gives only these two.
    expect(await getCourse(id)).toMatchObject({ id, name: "Analysis" });
  });

  test.each([
    ["a malformed id", () => "not-a-uuid"],
    ["an unknown id", () => randomUUID()],
    [
      "another Student's Course",
      () => seedCourse(CLASSMATE, "Thermodynamics", "2026-01-01T00:00:00Z"),
    ],
  ])("is null for %s", async (_case, courseId) => {
    expect(await getCourse(courseId())).toBeNull();
  });

  test("is null when signed out", async () => {
    const id = seedCourse(STUDENT, "Analysis", "2026-01-01T00:00:00Z");
    signedIn = null;

    expect(await getCourse(id)).toBeNull();
  });
});

describe("getMaterials", () => {
  test("gives the Student's Materials among the ids, leaving out missing and others'", async () => {
    const courseId = seedCourse(STUDENT, "Analysis", "2026-01-01T00:00:00Z");
    const mine = seedMaterial(STUDENT, courseId);
    const theirs = seedMaterial(
      CLASSMATE,
      seedCourse(CLASSMATE, "Thermodynamics", "2026-01-01T00:00:00Z"),
    );

    expect(await getMaterials([mine, theirs, randomUUID()])).toEqual([
      {
        id: mine,
        courseId,
        name: "Lecture 1",
        mediaType: "application/pdf",
        sizeBytes: 8,
        storagePath: `${STUDENT}/${courseId}/${mine}`,
      },
    ]);
  });

  test("is empty for no ids", async () => {
    expect(await getMaterials([])).toEqual([]);
  });
});
