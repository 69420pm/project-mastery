// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { materialChunksPath } from "@/features/courses/server";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";
import type { Supabase } from "@/lib/supabase/types";

/** The Brief's reads for its page, the study plan and the tutor. */

const STUDENT = "11111111-1111-1111-1111-111111111111";
const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const CLASSMATE_COURSE = "bbbbbbbb-c000-4000-8000-000000000001";
const [LATER, EARLIER] = [
  "aaaaaaaa-0000-4000-8000-000000000002",
  "aaaaaaaa-0000-4000-8000-000000000001",
];

let signedIn = true;
let db = createDb();

/** A Brief of COURSE with every field answered, or all left empty. */
function brief({ done }: { done: boolean }): FakeRow {
  return {
    course_id: COURSE,
    owner: STUDENT,
    exam_date: done ? "2026-12-03" : null,
    goal: done ? "good_grade" : null,
    open_book: done ? false : null,
    formula_sheet: done ? true : null,
    calculator: done ? false : null,
    scope_confirmed: done,
    notes: done ? "Heat exchangers!" : null,
    notes_updated_at: done ? "2026-10-05T12:00:00Z" : null,
  };
}

function createDb() {
  const material = (id: string, name: string, createdAt: string) => ({
    id,
    owner: STUDENT,
    course_id: COURSE,
    name,
    created_at: createdAt,
  });
  const chapter = (
    id: string,
    materialId: string,
    parentId: string | null,
    position: number,
    title: string,
  ) => ({
    id,
    owner: STUDENT,
    course_id: COURSE,
    material_id: materialId,
    parent_id: parentId,
    position,
    depth: position,
    title,
    exam_proposed: false,
    is_exam: null,
    exam_asked: false,
  });
  return fakeSupabase({
    tables: {
      courses: [
        { id: COURSE, owner: STUDENT },
        { id: CLASSMATE_COURSE, owner: "classmate" },
      ] as FakeRow[],
      materials: [
        material(LATER, "Lecture 2", "2026-10-02T00:00:00Z"),
        material(EARLIER, "Lecture 1", "2026-10-01T00:00:00Z"),
      ] as FakeRow[],
      // Lecture 2 holds an old exam, Klausur 2023, with a problem inside.
      chapters: [
        chapter("l2", LATER, null, 0, "Lecture 2"),
        chapter("klausur", LATER, "l2", 1, "Klausur 2023"),
        chapter("problem", LATER, "klausur", 2, "Aufgabe 1"),
      ] as FakeRow[],
      briefs: [] as FakeRow[],
      brief_excluded_materials: [] as FakeRow[],
      brief_messages: [] as FakeRow[],
      topics: [
        {
          id: "integrals",
          owner: STUDENT,
          course_id: COURSE,
          parent_id: null,
          name: "Integrals",
          position: 0,
        },
      ] as FakeRow[],
      exam_scopes: [] as FakeRow[],
    },
    primaryKeys: { briefs: ["course_id"] },
    defaults: {
      briefs: () => brief({ done: false }),
      brief_messages: () => ({ owner: STUDENT }),
    },
    canAccess: (table, row, tables) =>
      row.owner === STUDENT &&
      (table !== "briefs" ||
        tables.courses.some(
          (course) => course.id === row.course_id && course.owner === STUDENT,
        )),
  });
}

/**
 * The client, which resolves the excluded Materials' embedded Material, a
 * many-to-one embed the fake leaves out.
 */
function client() {
  return {
    ...db,
    from(table: Parameters<typeof db.from>[0]) {
      const builder = db.from(table);
      if (table !== "brief_excluded_materials") return builder;
      const then = builder.then.bind(builder);
      builder.then = (resolve, reject) =>
        then((result) => ({
          ...result,
          data: (result.data as FakeRow[]).map((row) => ({
            ...row,
            materials: db.tables.materials.find(
              (m) => m.id === row.material_id,
            ),
          })),
        })).then(resolve, reject);
      return builder;
    },
  } as unknown as Supabase;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/user", () => ({
  getUser: async () => (signedIn ? { id: STUDENT } : null),
  requireUser: async () => {
    if (!signedIn) throw new Error("NEXT_REDIRECT");
    return { id: STUDENT };
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => client(),
}));

const { getBrief, getExamFacts, getIntakeDone } = await import("./queries");

beforeEach(() => {
  signedIn = true;
  db = createDb();
});

describe("getExamFacts", () => {
  test("without a Brief, every fact is null", async () => {
    expect(await getExamFacts(client(), COURSE)).toEqual({
      examDate: null,
      goal: null,
    });
  });

  test("passes the date and goal through", async () => {
    db.tables.briefs.push(brief({ done: true }));

    expect(await getExamFacts(client(), COURSE)).toEqual({
      examDate: "2026-12-03",
      goal: "good_grade",
    });
  });
});

describe("getBrief", () => {
  test.each([
    ["a malformed id", "not-a-uuid"],
    ["another Student's Course", CLASSMATE_COURSE],
  ])("gives null for %s", async (_, courseId) => {
    expect(await getBrief(courseId)).toBeNull();
    expect(db.tables.brief_messages).toEqual([]);
  });

  test("returns the messages, the fields, the notes, the excluded Materials oldest first, the old exams, the reserved exam and the exam scopes", async () => {
    db.tables.briefs.push({
      ...brief({ done: true }),
      reserved_exam_answered: true,
      reserved_exam_chapter_id: "klausur",
    });
    // The problem inside the confirmed exam is no old exam of its own.
    for (const id of ["klausur", "problem"]) {
      db.tables.chapters.find((chapter) => chapter.id === id)!.is_exam = true;
    }
    db.tables.exam_scopes.push({
      owner: STUDENT,
      course_id: COURSE,
      topic_id: "integrals",
      scope: "emphasized",
      words: "Integrals matter most",
      created_at: "2026-10-05T12:00:00Z",
    });
    for (const id of [LATER, EARLIER]) {
      db.tables.brief_excluded_materials.push({
        course_id: COURSE,
        material_id: id,
        owner: STUDENT,
      });
    }

    const view = await getBrief(COURSE);

    expect(view).toMatchObject({
      courseId: COURSE,
      fields: {
        examDate: "2026-12-03",
        goal: "good_grade",
        openBook: false,
        formulaSheet: true,
        calculator: false,
        scopeConfirmed: true,
      },
      notes: "Heat exchangers!",
      notesUpdatedAt: "2026-10-05T12:00:00Z",
      excludedMaterials: [
        {
          id: EARLIER,
          name: "Lecture 1",
          href: materialChunksPath(COURSE, EARLIER),
        },
        {
          id: LATER,
          name: "Lecture 2",
          href: materialChunksPath(COURSE, LATER),
        },
      ],
      oldExams: [
        {
          id: "klausur",
          name: "Lecture 2 › Klausur 2023",
          href: materialChunksPath(COURSE, LATER),
        },
      ],
      reservedExam: {
        name: "Lecture 2 › Klausur 2023",
        href: materialChunksPath(COURSE, LATER),
      },
      examScopes: [
        {
          name: "Integrals",
          scope: "emphasized",
          words: "Integrals matter most",
        },
      ],
    });
    expect(view?.messages).toHaveLength(1);
  });
});

describe("getIntakeDone", () => {
  test("is false when signed out, for a malformed id or without a Brief", async () => {
    db.tables.briefs.push(brief({ done: true }));
    expect(await getIntakeDone("not-a-uuid")).toBe(false);
    expect(await getIntakeDone(CLASSMATE_COURSE)).toBe(false);
    signedIn = false;
    expect(await getIntakeDone(COURSE)).toBe(false);
  });

  test.each([
    [true, brief({ done: true })],
    [false, brief({ done: false })],
    [true, { ...brief({ done: true }), calculator: null }],
    [false, { ...brief({ done: true }), scope_confirmed: false }],
  ])("is %s for the Brief's answers", async (done, row) => {
    db.tables.briefs.push(row);
    expect(await getIntakeDone(COURSE)).toBe(done);
  });
});
