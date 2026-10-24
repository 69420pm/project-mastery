// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

/**
 * The map page's study reads: KC learning, KC states, the plan and a new
 * Chat's opening line. The stored map is given; Priorities, the Brief and
 * the attempts come from local tables.
 */

vi.mock("server-only", () => ({}));

const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const [PRIOR, THRUST, EFFICIENCY, NOZZLE] = [1, 2, 3, 4].map(
  (n) => `aaaaaaaa-0000-4000-8000-00000000000${n}`,
) as [string, string, string, string];

const MAP = {
  bigIdeas: [{ id: "big", name: "Thrust generation" }],
  kcs: [
    { id: PRIOR, name: "Newton's second law", type: "prior", bigIdea: null },
    { id: THRUST, name: "Thrust equation", type: "procedure", bigIdea: "big" },
    {
      id: EFFICIENCY,
      name: "Propulsive efficiency",
      type: "concept",
      bigIdea: "big",
    },
    { id: NOZZLE, name: "Nozzle flow", type: "concept", bigIdea: "big" },
  ],
  prerequisites: [
    { from: PRIOR, to: THRUST },
    { from: THRUST, to: EFFICIENCY },
  ],
  exercises: [],
};
const SESSION = "aaaaaaaa-5000-4000-8000-000000000001";
const QUESTION = "aaaaaaaa-9000-4000-8000-000000000001";
const EMPTY_MAP = { bigIdeas: [], kcs: [], prerequisites: [], exercises: [] };

let signedIn = true;
let map: typeof MAP | typeof EMPTY_MAP = MAP;
let db = createDb();

function createDb() {
  return fakeSupabase({
    tables: {
      briefs: [] as FakeRow[],
      kc_priorities: [
        { course_id: COURSE, kc_id: THRUST, priority: "0.8" },
        { course_id: COURSE, kc_id: NOZZLE, priority: "0.1" },
      ] as FakeRow[],
      study_sessions: [{ id: SESSION, course_id: COURSE }] as FakeRow[],
      questions: [{ id: QUESTION, session_id: SESSION, exercise_id: null }],
      attempts: [] as FakeRow[],
    },
    foreignKeys: {
      questions: { session_id: "study_sessions" },
      attempts: { question_id: "questions", session_id: "study_sessions" },
    },
  });
}

vi.mock("@/lib/auth/user", () => ({
  getUser: async () => (signedIn ? { id: "student" } : null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));
vi.mock("@/features/knowledge-map/server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadStoredMap: async () => map,
}));

const { getKcLearning, getKcStates, getOpeningLine, getPlan } =
  await import("@/features/study/server");

const DAY_MS = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();
const day = (days: number) => at(days).slice(0, 10);

/** A stored attempt on a KC `days` from now. */
const attempt = (kcId: string, days: number, correct = true): FakeRow => ({
  id: randomUUID(),
  question_id: QUESTION,
  session_id: SESSION,
  kc_id: kcId,
  result: correct ? "full" : "wrong",
  help: "none",
  created_at: at(days),
});

beforeEach(() => {
  signedIn = true;
  map = MAP;
  db = createDb();
  // Stored newest first: the readers order them by time. Two correct answers
  // a day apart climb to level 2, due three days later.
  db.tables.attempts.push(attempt(THRUST, -5), attempt(THRUST, -6));
});

describe.each([
  ["signed out", COURSE, false],
  ["a malformed id", "not-a-uuid", true],
])("%s", (_, courseId, user) => {
  test("gives no learning, states or plan", async () => {
    signedIn = user;

    expect(await getKcLearning(courseId)).toEqual({});
    expect(await getKcStates(courseId)).toEqual({});
    expect(await getPlan(courseId)).toEqual({
      phase: null,
      share: null,
      leftOut: [],
      hoursPerWeek: null,
    });
  });
});

describe("getKcLearning", () => {
  test("replays a taught KC's attempts to its state, newest first", async () => {
    const learning = await getKcLearning(COURSE);

    expect(learning[THRUST]).toEqual({
      state: "due",
      level: 2,
      nextReview: day(-2),
      attempts: db.tables.attempts.map((row) => ({
        createdAt: row.created_at,
        result: "full",
        help: "none",
        exerciseId: null,
      })),
      candidate: false,
      anchors: [],
    });
  });

  test("reads only the Course's sessions, and a partial answer as wrong", async () => {
    db.tables.study_sessions.push({ id: "other", course_id: "other-course" });
    db.tables.questions.push({ id: "q2", session_id: "other" });
    db.tables.attempts.push(
      { ...attempt(NOZZLE, -1), question_id: "q2", session_id: "other" },
      { ...attempt(THRUST, -1), result: "partial" },
    );

    const learning = await getKcLearning(COURSE);

    expect(learning[NOZZLE]).toMatchObject({ state: "new", attempts: [] });
    expect(learning[THRUST]).toMatchObject({ level: 1, nextReview: day(0) });
  });

  test("lists unattempted candidates with their anchors, and nothing else", async () => {
    const learning = await getKcLearning(COURSE);

    expect(learning[EFFICIENCY]).toEqual({
      state: "new",
      level: null,
      nextReview: null,
      attempts: [],
      candidate: true,
      anchors: [{ id: THRUST, name: "Thrust equation" }],
    });
    expect(learning[NOZZLE]).toMatchObject({ candidate: true, anchors: [] });
    // Prior knowledge is no candidate.
    expect(Object.keys(learning).toSorted()).toEqual(
      [THRUST, EFFICIENCY, NOZZLE].toSorted(),
    );
  });
});

describe("getKcStates", () => {
  test("gives each taught KC its replayed state", async () => {
    db.tables.attempts.push(attempt(EFFICIENCY, 0, false));

    expect(await getKcStates(COURSE)).toEqual({
      [THRUST]: { state: "due", level: 2, nextReview: day(-2) },
      [EFFICIENCY]: { state: "learning", level: 1, nextReview: day(1) },
    });
  });
});

describe("getPlan", () => {
  test("gives the Phase, the share, the left-out names and the weekly hours", async () => {
    // Half an hour before the final week: one of the two untaught KCs fits.
    db.tables.briefs.push({
      course_id: COURSE,
      exam_date: day(21),
      hours_per_week: "0.25",
      goal: null,
    });

    expect(await getPlan(COURSE)).toEqual({
      phase: "build",
      share: 66,
      leftOut: [{ id: EFFICIENCY, name: "Propulsive efficiency" }],
      hoursPerWeek: 0.25,
    });
  });

  test("has no Phase without an exam date", async () => {
    expect(await getPlan(COURSE)).toMatchObject({ phase: null, share: null });
  });
});

describe("getOpeningLine", () => {
  test("counts the due reviews of the map", async () => {
    expect(await getOpeningLine(COURSE)).toBe(
      "1 review due, then something new. Or ask about anything.",
    );
  });

  test("asks for a map without one", async () => {
    map = EMPTY_MAP;

    expect(await getOpeningLine(COURSE)).toBe(
      "Build your Knowledge map to start studying, or ask about anything.",
    );
  });
});
