// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase } from "@/lib/supabase/testing";

const STUDENT = "11111111-1111-1111-1111-111111111111";
const CLASSMATE = "22222222-2222-2222-2222-222222222222";

let signedIn: string | null = STUDENT;
let db = createDb();

/**
 * The local tables and Storage, with the ownership rules of the real
 * policies: a Material also needs a Course of the Student's.
 */
function createDb() {
  return fakeSupabase({
    tables: { courses: [], materials: [] },
    userId: signedIn ?? undefined,
    defaults: {
      courses: () => ({ owner: signedIn }),
      materials: () => ({ owner: signedIn }),
    },
    canAccess: (table, row, tables) =>
      row.owner === signedIn &&
      (table !== "materials" ||
        tables.courses.some(
          (course) => course.id === row.course_id && course.owner === signedIn,
        )),
  });
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/user", () => ({
  getUser: async () => (signedIn ? { id: signedIn, email: undefined } : null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));

const {
  createCourse,
  deleteCourse,
  deleteMaterial,
  openMaterial,
  registerMaterial,
  renameCourse,
  renameMaterial,
} = await import("./actions");

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

const BUCKET = "course-files";
const PDF = "application/pdf";

/**
 * Puts a file in Storage as if the Student's browser had uploaded it for a
 * new Material, and returns what registering it takes.
 */
function uploadFile(
  courseId: string,
  {
    owner = STUDENT,
    body = "%PDF-1.7 lecture",
    contentType = PDF,
  }: { owner?: string; body?: string; contentType?: string } = {},
) {
  const materialId = randomUUID();
  const path = `${owner}/${courseId}/${materialId}`;
  db.files.seed(BUCKET, path, { body, contentType });
  return {
    path,
    input: {
      materialId,
      courseId,
      name: "Lecture 1",
      mediaType: contentType,
      sizeBytes: new TextEncoder().encode(body).byteLength,
    },
  };
}

describe("registerMaterial", () => {
  test("registers an uploaded file as a Material of the Course", async () => {
    const courseId = seedCourse(STUDENT, "Analysis");
    const { path, input } = uploadFile(courseId);

    const result = await registerMaterial({ ...input, name: " Lecture 1 " });

    expect(result).toEqual({ ok: true, data: { id: input.materialId } });
    expect(db.tables.materials).toEqual([
      expect.objectContaining({
        id: input.materialId,
        owner: STUDENT,
        course_id: courseId,
        name: "Lecture 1",
        media_type: PDF,
        size_bytes: input.sizeBytes,
        storage_path: path,
      }),
    ]);
    expect(db.files.paths(BUCKET)).toEqual([path]);
  });

  test.each([
    [
      "a file over 20 MB",
      { sizeBytes: 20 * 1024 * 1024 + 1 },
      { sizeBytes: ["Keep each file to 20 MB or smaller."] },
    ],
    [
      "another file type",
      { mediaType: "application/msword" },
      { mediaType: ["Upload a PDF or a PNG, JPEG or WebP image."] },
    ],
    ["an empty name", { name: "  " }, { name: ["Enter a name."] }],
  ])(
    "refuses %s, stores no Material and removes the upload",
    async (_case, change, fieldErrors) => {
      const courseId = seedCourse(STUDENT, "Analysis");
      const { input } = uploadFile(courseId);

      const result = await registerMaterial({ ...input, ...change });

      expect(result).toMatchObject({ ok: false, fieldErrors });
      expect(db.tables.materials).toEqual([]);
      expect(db.files.paths(BUCKET)).toEqual([]);
    },
  );

  test("accepts a file of exactly 20 MB", async () => {
    const courseId = seedCourse(STUDENT, "Analysis");
    const { input } = uploadFile(courseId, {
      body: "x".repeat(20 * 1024 * 1024),
    });

    const result = await registerMaterial(input);

    expect(result.ok).toBe(true);
  });

  test("refuses a file that never reached Storage", async () => {
    const courseId = seedCourse(STUDENT, "Analysis");

    const result = await registerMaterial({
      materialId: randomUUID(),
      courseId,
      name: "Lecture 1",
      mediaType: PDF,
      sizeBytes: 100,
    });

    expect(result).toEqual({
      ok: false,
      message: "The upload did not finish. Please try again.",
    });
    expect(db.tables.materials).toEqual([]);
  });

  test.each([
    ["size", { sizeBytes: 3 }],
    ["type", { mediaType: "image/png" }],
  ])(
    "refuses an upload whose stored %s differs, and removes it",
    async (_case, change) => {
      const courseId = seedCourse(STUDENT, "Analysis");
      const { input } = uploadFile(courseId);

      const result = await registerMaterial({ ...input, ...change });

      expect(result).toEqual({
        ok: false,
        message: "The upload did not finish. Please try again.",
      });
      expect(db.tables.materials).toEqual([]);
      expect(db.files.paths(BUCKET)).toEqual([]);
    },
  );

  test("never adds a Material to another Student's Course, and removes the upload", async () => {
    const courseId = seedCourse(CLASSMATE, "Thermodynamics");
    const { input } = uploadFile(courseId);

    const result = await registerMaterial(input);

    expect(result).toEqual({
      ok: false,
      message: "This course does not exist.",
    });
    expect(db.tables.materials).toEqual([]);
    expect(db.files.paths(BUCKET)).toEqual([]);
  });

  test("never registers another Student's file", async () => {
    const courseId = seedCourse(STUDENT, "Analysis");
    const { path, input } = uploadFile(courseId, { owner: CLASSMATE });

    const result = await registerMaterial(input);

    expect(result.ok).toBe(false);
    expect(db.tables.materials).toEqual([]);
    expect(db.files.paths(BUCKET)).toEqual([path]);
  });

  test("refuses a signed-out visitor", async () => {
    const courseId = seedCourse(STUDENT, "Analysis");
    const { input } = uploadFile(courseId);
    signedIn = null;

    const result = await registerMaterial(input);

    expect(result).toEqual({
      ok: false,
      message: "Sign in again to continue.",
    });
    expect(db.tables.materials).toEqual([]);
  });
});

/**
 * Stores a Material with its file as if `owner` had uploaded it, and returns
 * its id and path.
 */
function seedMaterial(owner: string, courseId: string, name = "Lecture 1") {
  const id = randomUUID();
  const path = `${owner}/${courseId}/${id}`;
  db.files.seed(BUCKET, path, { body: "%PDF-1.7", contentType: PDF });
  db.tables.materials.push({
    id,
    owner,
    course_id: courseId,
    name,
    media_type: PDF,
    size_bytes: 8,
    storage_path: path,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
  return { id, path };
}

const materialName = (materialId: string) =>
  db.tables.materials.find((material) => material.id === materialId)?.name;

const materialNotFound = {
  ok: false,
  message: "This material does not exist.",
};

describe("renameMaterial", () => {
  test("renames the Student's Material to the trimmed name", async () => {
    const material = seedMaterial(STUDENT, seedCourse(STUDENT, "Analysis"));

    const result = await renameMaterial({
      materialId: material.id,
      name: "  Lecture 1 (annotated) ",
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(materialName(material.id)).toBe("Lecture 1 (annotated)");
  });

  test("refuses a name over 200 characters", async () => {
    const material = seedMaterial(STUDENT, seedCourse(STUDENT, "Analysis"));

    const result = await renameMaterial({
      materialId: material.id,
      name: "x".repeat(201),
    });

    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { name: ["Keep the name to 200 characters or fewer."] },
    });
    expect(materialName(material.id)).toBe("Lecture 1");
  });

  test("never renames another Student's Material", async () => {
    const material = seedMaterial(
      CLASSMATE,
      seedCourse(CLASSMATE, "Thermodynamics"),
    );

    const result = await renameMaterial({
      materialId: material.id,
      name: "Hijacked",
    });

    expect(result).toEqual(materialNotFound);
    expect(materialName(material.id)).toBe("Lecture 1");
  });
});

describe("deleteMaterial", () => {
  test("removes the Material's file, then the Material", async () => {
    const courseId = seedCourse(STUDENT, "Analysis");
    const material = seedMaterial(STUDENT, courseId);
    const kept = seedMaterial(STUDENT, courseId, "Lecture 2");

    const result = await deleteMaterial({ materialId: material.id });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(db.tables.materials.map((row) => row.id)).toEqual([kept.id]);
    expect(db.files.paths(BUCKET)).toEqual([kept.path]);
  });

  test("keeps the Material when its file cannot be removed", async () => {
    const material = seedMaterial(STUDENT, seedCourse(STUDENT, "Analysis"));
    db.files.fail("remove");

    const result = await deleteMaterial({ materialId: material.id });

    expect(result).toEqual({
      ok: false,
      message: "The material could not be deleted. Please try again.",
    });
    expect(materialName(material.id)).toBe("Lecture 1");
    expect(db.files.paths(BUCKET)).toEqual([material.path]);
  });

  test("never deletes another Student's Material", async () => {
    const material = seedMaterial(
      CLASSMATE,
      seedCourse(CLASSMATE, "Thermodynamics"),
    );

    const result = await deleteMaterial({ materialId: material.id });

    expect(result).toEqual(materialNotFound);
    expect(materialName(material.id)).toBe("Lecture 1");
    expect(db.files.paths(BUCKET)).toEqual([material.path]);
  });
});

describe("deleteCourse with Materials", () => {
  test("removes the Course's files, then the Course", async () => {
    const courseId = seedCourse(STUDENT, "Analysis");
    seedMaterial(STUDENT, courseId);
    // An upload whose registering never happened.
    uploadFile(courseId);
    const other = seedMaterial(STUDENT, seedCourse(STUDENT, "Statistics"));

    const result = await deleteCourse({ courseId });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(nameOf(courseId)).toBeUndefined();
    expect(db.files.paths(BUCKET)).toEqual([other.path]);
  });

  test.each(["list", "remove"] as const)(
    "keeps the Course and its Materials when Storage fails to %s its files",
    async (operation) => {
      const courseId = seedCourse(STUDENT, "Analysis");
      const material = seedMaterial(STUDENT, courseId);
      db.files.fail(operation);

      const result = await deleteCourse({ courseId });

      expect(result).toEqual({
        ok: false,
        message:
          "The course's materials could not be deleted, so the course was kept. Please try again.",
      });
      expect(nameOf(courseId)).toBe("Analysis");
      expect(materialName(material.id)).toBe("Lecture 1");
      expect(db.files.paths(BUCKET)).toEqual([material.path]);
    },
  );

  test("never removes the files of another Student's Course", async () => {
    const courseId = seedCourse(CLASSMATE, "Thermodynamics");
    const material = seedMaterial(CLASSMATE, courseId);

    await deleteCourse({ courseId });

    expect(db.files.paths(BUCKET)).toEqual([material.path]);
  });
});

describe("openMaterial", () => {
  test("gives a short-lived link to the Student's Material", async () => {
    const material = seedMaterial(STUDENT, seedCourse(STUDENT, "Analysis"));

    const result = await openMaterial({ materialId: material.id });

    expect(result).toEqual({
      ok: true,
      data: {
        name: "Lecture 1",
        mediaType: PDF,
        url: expect.stringContaining(material.path),
      },
    });
  });

  test("never opens another Student's Material", async () => {
    const material = seedMaterial(
      CLASSMATE,
      seedCourse(CLASSMATE, "Thermodynamics"),
    );

    const result = await openMaterial({ materialId: material.id });

    expect(result).toEqual(materialNotFound);
  });
});
