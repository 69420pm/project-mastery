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
    // Postgres returns a numeric as text.
    hours_per_week: done ? "5.5" : null,
    question_style: done ? "written" : null,
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
      briefs: [] as FakeRow[],
      brief_excluded_materials: [] as FakeRow[],
      brief_messages: [] as FakeRow[],
      findings: [] as FakeRow[],
      finding_sources: [] as FakeRow[],
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
      hoursPerWeek: null,
      goal: null,
    });
  });

  test("passes the date and goal through and reads the hours as a number", async () => {
    db.tables.briefs.push(brief({ done: true }));

    expect(await getExamFacts(client(), COURSE)).toEqual({
      examDate: "2026-12-03",
      hoursPerWeek: 5.5,
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

  test("returns the messages, the fields, the notes and the excluded Materials oldest first", async () => {
    db.tables.briefs.push(brief({ done: true }));
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
        questionStyle: "written",
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
    [false, { ...brief({ done: true }), calculator: null }],
    [false, { ...brief({ done: true }), scope_confirmed: false }],
  ])("is %s for the Brief's answers", async (done, row) => {
    db.tables.briefs.push(row);
    expect(await getIntakeDone(COURSE)).toBe(done);
  });
});
