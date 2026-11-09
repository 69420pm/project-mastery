// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

/**
 * Priorities computed when read, on the Student's session client: the
 * stored map and Topics stand in for the knowledge-map readers, and Row
 * Level Security leaves another Student's Course empty.
 */

const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const OTHER = "aaaaaaaa-c000-4000-8000-000000000002";

let signedIn = true;
let db = createDb();

function chapter(
  id: string,
  parentId: string | null,
  depth: number,
  isExam: boolean | null,
): FakeRow {
  return {
    id,
    course_id: COURSE,
    material_id: "notes",
    parent_id: parentId,
    title: id,
    depth,
    is_exam: isExam,
  };
}

function createDb() {
  return fakeSupabase({
    tables: {
      materials: [
        { id: "notes", course_id: COURSE, name: "Notes" },
        { id: "extra", course_id: COURSE, name: "Extra" },
      ] as FakeRow[],
      // The Notes hold an old exam the Student confirmed, with a problem
      // Chapter inside it.
      chapters: [
        chapter("n0", null, 0, null),
        chapter("exam", "n0", 1, true),
        chapter("problem", "exam", 2, null),
      ],
      chunks: [
        { id: "c1", course_id: COURSE, material_id: "notes", chapter_id: "n0" },
        { id: "c2", course_id: COURSE, material_id: "extra", chapter_id: null },
        {
          id: "q1",
          course_id: COURSE,
          material_id: "notes",
          chapter_id: "problem",
        },
      ] as FakeRow[],
      brief_excluded_materials: [
        { course_id: COURSE, material_id: "extra" },
      ] as FakeRow[],
      exam_scopes: [] as FakeRow[],
    },
  });
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/user", () => ({
  getUser: async () => (signedIn ? { id: "student" } : null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));
vi.mock("@/features/knowledge-map/server", async () => ({
  loadStoredMap: async (_: unknown, courseId: string) => ({
    kcs:
      courseId === COURSE
        ? [
            { id: "k1", sources: ["c1"] },
            { id: "k2", sources: ["c1"] },
            { id: "k3", sources: ["c2"] },
          ]
        : [],
    prerequisites: [],
    exercises:
      courseId === COURSE ? [{ questionChunk: "q1", kcs: ["k1"] }] : [],
  }),
  // t1 sits inside "top", which holds no KCs of its own.
  loadTopicTree: async () => [
    { id: "top", parentId: null, kcs: [] },
    { id: "t1", parentId: "top", kcs: ["k1", "k2"] },
  ],
  topicLineage: (
    await vi.importActual<typeof import("@/features/knowledge-map/server")>(
      "@/features/knowledge-map/server",
    )
  ).topicLineage,
}));

const { getPriorities, loadKcPriorities } = await import("./priorities");

beforeEach(() => {
  signedIn = true;
  db = createDb();
});

describe("loadKcPriorities", () => {
  test("computes each KC's Priority from the map, Materials and Brief", async () => {
    expect(await loadKcPriorities(db as never, COURSE)).toEqual({
      k1: 1,
      k2: 0.25,
      k3: 0,
    });
  });

  test("weighs in the Brief's exam scopes, inherited down the Topic tree", async () => {
    db.tables.exam_scopes.push({
      course_id: COURSE,
      topic_id: "top",
      scope: "emphasized",
      words: "All of it matters",
      created_at: "2026-10-29",
    });
    expect(await loadKcPriorities(db as never, COURSE)).toEqual({
      k1: 2,
      k2: 0.5,
      k3: 0,
    });
  });
});

describe("getPriorities", () => {
  test("gives each KC its level, value and reasons", async () => {
    const { kcs } = await getPriorities(COURSE);

    expect(kcs.k1).toEqual({
      level: "high",
      value: 1,
      reasons: ["Tested in 1 old-exam Exercise", "Tested in 1 Exercise"],
    });
    expect(kcs.k3).toEqual({
      level: "excluded",
      value: 0,
      reasons: ["Excluded: you skip Extra"],
    });
  });

  test("gives none signed out, for an invalid id or another's Course", async () => {
    expect(await getPriorities("not-a-uuid")).toEqual({ kcs: {} });
    expect(await getPriorities(OTHER)).toEqual({ kcs: {} });
    signedIn = false;
    expect(await getPriorities(COURSE)).toEqual({ kcs: {} });
  });
});
