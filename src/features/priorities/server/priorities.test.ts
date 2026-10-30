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

function createDb() {
  return fakeSupabase({
    tables: {
      materials: [
        { id: "notes", course_id: COURSE, name: "Notes", is_exam: false },
        { id: "exam", course_id: COURSE, name: "Exam 2024", is_exam: true },
        { id: "extra", course_id: COURSE, name: "Extra", is_exam: false },
      ] as FakeRow[],
      chunks: [
        { id: "c1", course_id: COURSE, material_id: "notes" },
        { id: "c2", course_id: COURSE, material_id: "extra" },
        { id: "q1", course_id: COURSE, material_id: "exam" },
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
vi.mock("@/features/knowledge-map/server", () => ({
  loadStoredMap: async (_: unknown, courseId: string) => ({
    kcs:
      courseId === COURSE
        ? [
            { id: "k1", bigIdea: "b1", sources: ["c1"] },
            { id: "k2", bigIdea: "b1", sources: ["c1"] },
            { id: "k3", bigIdea: "b1", sources: ["c2"] },
          ]
        : [],
    exercises:
      courseId === COURSE ? [{ questionChunk: "q1", kcs: ["k1"] }] : [],
  }),
  loadStoredTopics: async () => [{ id: "t1", kcs: ["k1", "k2"] }],
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

  test("weighs in the Brief's exam scopes", async () => {
    db.tables.exam_scopes.push({
      course_id: COURSE,
      big_idea_id: null,
      topic_id: "t1",
      scope: "emphasized",
      words: "Topic 1 matters",
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
