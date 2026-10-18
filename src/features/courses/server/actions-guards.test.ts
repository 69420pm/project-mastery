// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase } from "@/lib/supabase/testing";

/**
 * The guards every Course and Material action shares (signed out, a
 * malformed id, a missing Course or Material), and the registering and
 * opening outcomes beyond the happy path.
 */

const STUDENT = "11111111-1111-1111-1111-111111111111";
const BUCKET = "course-files";
const PDF = "application/pdf";

let signedIn: string | null = STUDENT;
/** Makes the materials policy refuse inserts, as when the Course just went. */
let materialsDenied = false;
let db = createDb();

function createDb() {
  return fakeSupabase({
    tables: { courses: [], materials: [], chats: [], chat_messages: [] },
    userId: STUDENT,
    defaults: { materials: () => ({ owner: signedIn }) },
    canAccess: (table, row) =>
      table === "chat_messages" ||
      (row.owner === signedIn && !(table === "materials" && materialsDenied)),
  });
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/user", () => ({
  getUser: async () => (signedIn ? { id: signedIn, email: undefined } : null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));
vi.mock("workflow/api", () => ({ start: vi.fn(async () => ({})) }));

const actions = await import("./actions");

let courseId: string;
let materialId: string;
let materialPath: string;

beforeEach(() => {
  signedIn = STUDENT;
  materialsDenied = false;
  db = createDb();
  courseId = randomUUID();
  materialId = randomUUID();
  materialPath = `${STUDENT}/${courseId}/${materialId}`;
  db.tables.courses.push({ id: courseId, owner: STUDENT, name: "Analysis" });
  db.tables.materials.push({
    id: materialId,
    owner: STUDENT,
    course_id: courseId,
    name: "Lecture 1",
    media_type: PDF,
    size_bytes: 8,
    storage_path: materialPath,
  });
  db.files.seed(BUCKET, materialPath, { body: "%PDF-1.7", contentType: PDF });
});

/** Everything an action could change: the rows and the stored files. */
const snapshot = () => ({
  tables: structuredClone(db.tables),
  files: db.files.paths(BUCKET),
});

type Ids = { courseId: string; materialId: string };
const calls = {
  renameCourse: (ids: Ids) =>
    actions.renameCourse({ courseId: ids.courseId, name: "Renamed" }),
  deleteCourse: (ids: Ids) => actions.deleteCourse({ courseId: ids.courseId }),
  renameMaterial: (ids: Ids) =>
    actions.renameMaterial({ materialId: ids.materialId, name: "Renamed" }),
  deleteMaterial: (ids: Ids) =>
    actions.deleteMaterial({ materialId: ids.materialId }),
  countMaterialChats: (ids: Ids) =>
    actions.countMaterialChats({ materialId: ids.materialId }),
  openMaterial: (ids: Ids) =>
    actions.openMaterial({ materialId: ids.materialId }),
};
const names = Object.keys(calls) as Array<keyof typeof calls>;

describe("every Course and Material action", () => {
  test.each(names)(
    "%s refuses a signed-out visitor and touches nothing",
    async (name) => {
      const before = snapshot();
      signedIn = null;

      const result = await calls[name]({ courseId, materialId });

      expect(result).toEqual({
        ok: false,
        message: "Sign in again to continue.",
      });
      expect(snapshot()).toEqual(before);
    },
  );

  test.each(names)(
    "%s refuses a malformed id and touches nothing",
    async (name) => {
      const before = snapshot();

      const result = await calls[name]({
        courseId: "not-a-uuid",
        materialId: "not-a-uuid",
      });

      const field = name.endsWith("Course") ? "courseId" : "materialId";
      expect(result).toMatchObject({
        ok: false,
        fieldErrors: { [field]: [expect.any(String)] },
      });
      expect(snapshot()).toEqual(before);
    },
  );

  test.each([
    ["renameCourse", "This course does not exist."],
    ["deleteCourse", "This course does not exist."],
    ["renameMaterial", "This material does not exist."],
    ["deleteMaterial", "This material does not exist."],
    ["openMaterial", "This material does not exist."],
  ] as const)(
    "%s reports a missing one as not found and touches nothing",
    async (name, message) => {
      const before = snapshot();

      const result = await calls[name]({
        courseId: randomUUID(),
        materialId: randomUUID(),
      });

      expect(result).toEqual({ ok: false, message });
      expect(snapshot()).toEqual(before);
    },
  );

  test("countMaterialChats counts no Chats for a missing Material", async () => {
    const result = await actions.countMaterialChats({
      materialId: randomUUID(),
    });

    expect(result).toEqual({ ok: true, data: { chatCount: 0 } });
  });
});

describe("registerMaterial", () => {
  /** An upload of a new Material in the Course, as the browser stores it. */
  function upload() {
    const id = randomUUID();
    const path = `${STUDENT}/${courseId}/${id}`;
    db.files.seed(BUCKET, path, { body: "%PDF-1.7", contentType: PDF });
    const input = {
      materialId: id,
      courseId,
      name: "Lecture 2",
      mediaType: PDF,
      sizeBytes: 8,
    };
    return { id, path, input };
  }

  test("registers the same upload twice as one Material, and keeps its file", async () => {
    const { id, path, input } = upload();

    const first = await actions.registerMaterial(input);
    const second = await actions.registerMaterial(input);

    expect(first).toEqual({ ok: true, data: { id } });
    expect(second).toEqual({ ok: true, data: { id } });
    expect(db.tables.materials.filter((row) => row.id === id)).toHaveLength(1);
    expect(db.files.paths(BUCKET)).toContain(path);
  });

  test("reports a refused insert as a missing Course, and removes the upload", async () => {
    const { id, path, input } = upload();
    materialsDenied = true;

    const result = await actions.registerMaterial(input);

    expect(result).toEqual({
      ok: false,
      message: "This course does not exist.",
    });
    expect(db.tables.materials.map((row) => row.id)).not.toContain(id);
    expect(db.files.paths(BUCKET)).not.toContain(path);
  });
});

describe("openMaterial", () => {
  test("gives a link that works for five minutes", async () => {
    const result = await actions.openMaterial({ materialId });

    expect(
      result.ok && new URL(result.data.url).searchParams.get("expiresIn"),
    ).toBe("300");
  });

  test("reports a link that could not be signed", async () => {
    db.files.fail("createSignedUrl");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await actions.openMaterial({ materialId });

    expect(result).toEqual({
      ok: false,
      message: "The material could not be opened. Please try again.",
    });
  });
});
