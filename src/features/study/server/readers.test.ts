// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TopicChoice } from "@/features/study/domain/plan";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

/**
 * The map page's study reads: KC learning and the study state. The stored
 * map is given; Priorities, the Brief, the attempts and the mocks come from
 * local tables.
 */

vi.mock("server-only", () => ({}));

const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const OTHER_COURSE = "bbbbbbbb-c000-4000-8000-000000000001";
const [PRIOR, THRUST, EFFICIENCY, NOZZLE] = [1, 2, 3, 4].map(
  (n) => `aaaaaaaa-0000-4000-8000-00000000000${n}`,
) as [string, string, string, string];

const MAP = {
  kcs: [
    { id: PRIOR, name: "Newton's second law" },
    { id: THRUST, name: "Thrust equation" },
    { id: EFFICIENCY, name: "Propulsive efficiency" },
    { id: NOZZLE, name: "Nozzle flow" },
  ],
  prerequisites: [
    { from: PRIOR, to: THRUST },
    { from: THRUST, to: EFFICIENCY },
  ],
  exercises: [],
};
const SESSION = "aaaaaaaa-5000-4000-8000-000000000001";
const OPEN_SESSION = "aaaaaaaa-5000-4000-8000-000000000002";
const CHAT = "aaaaaaaa-c400-4000-8000-000000000001";
const QUESTION = "aaaaaaaa-9000-4000-8000-000000000001";
const EMPTY_MAP = { kcs: [], prerequisites: [], exercises: [] };

const DAY_MS = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();
const day = (days: number) => at(days).slice(0, 10);

let signedIn = true;
let map: typeof MAP | typeof EMPTY_MAP = MAP;
let db = createDb();

function createDb() {
  return fakeSupabase({
    tables: {
      briefs: [] as FakeRow[],
      study_sessions: [
        // Ended four days ago; the other one's Chat had a message just now.
        { id: SESSION, course_id: COURSE, chat_id: null, ended_at: at(-4) },
        { id: OPEN_SESSION, course_id: COURSE, chat_id: CHAT, ended_at: null },
      ] as FakeRow[],
      chats: [{ id: CHAT, last_message_at: at(0) }],
      chat_messages: [] as FakeRow[],
      questions: [{ id: QUESTION, session_id: SESSION, exercise_id: null }],
      attempts: [] as FakeRow[],
      mock_exams: [] as FakeRow[],
      mock_items: [] as FakeRow[],
    },
    foreignKeys: {
      questions: { session_id: "study_sessions" },
      attempts: { question_id: "questions", session_id: "study_sessions" },
      mock_items: { mock_id: "mock_exams" },
    },
  });
}

vi.mock("@/lib/auth/user", () => ({
  getUser: async () => (signedIn ? { id: "student" } : null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));
vi.mock("@/features/priorities/server", () => ({
  loadKcPriorities: async (_: unknown, courseId: string) =>
    courseId === COURSE ? { [THRUST]: 0.8, [NOZZLE]: 0.1 } : {},
}));
vi.mock("@/features/knowledge-map/server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadStoredMap: async () => map,
  // Row Level Security leaves another Student's Topics out.
  loadStoredTopics: async (_: unknown, courseId: string) =>
    courseId === COURSE
      ? [
          {
            id: "t1",
            name: "Thrust",
            centralQuestion: "How is thrust made?",
            kcs: [THRUST, EFFICIENCY],
          },
          {
            id: "t2",
            name: "Nozzles",
            centralQuestion: "What does a nozzle do?",
            kcs: [NOZZLE],
          },
        ]
      : [],
}));

// The Student's pins and skips; RLS (`topic_choices.test.sql`) keeps another
// Student's out.
let choices: TopicChoice[] = [];
vi.mock("@/features/study/server/choices", () => ({
  loadTopicChoices: async () => choices,
}));

const { getKcLearning, getStudyState } =
  await import("@/features/study/server");

/** A stored attempt on a KC `days` from now, in the ended session. */
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
  choices = [];
  map = MAP;
  db = createDb();
  // Stored newest first: the readers order them by time. A wrong answer
  // teaches Thrust; the next day's Good reviews it, due three days later.
  db.tables.attempts.push(attempt(THRUST, -5), attempt(THRUST, -6, false));
});

describe.each([
  ["signed out", COURSE, false],
  ["a malformed id", "not-a-uuid", true],
])("%s", (_, courseId, user) => {
  test("gives no learning and no study state", async () => {
    signedIn = user;

    expect(await getKcLearning(courseId)).toEqual({});
    expect(await getStudyState(courseId)).toMatchObject({
      hasMap: false,
      ranking: [],
      scope: [],
      progress: { learned: 0, total: 0, daysIn: null, daysLeft: null },
      lastMockPercent: null,
    });
  });
});

describe("getKcLearning", () => {
  test("replays a taught KC's attempts to its band, newest first", async () => {
    const learning = await getKcLearning(COURSE);

    expect(learning[THRUST]).toEqual({
      band: "fading",
      recallToday: expect.closeTo(0.85, 1),
      nextReview: day(-2),
      attempts: db.tables.attempts.map((row) => ({
        createdAt: row.created_at,
        result: row.result,
        help: "none",
        exerciseId: null,
      })),
    });
  });

  test("reads only the Course's sessions", async () => {
    db.tables.study_sessions.push({
      id: "other",
      course_id: "other-course",
      ended_at: at(-1),
    });
    db.tables.questions.push({ id: "q2", session_id: "other" });
    db.tables.attempts.push({
      ...attempt(NOZZLE, -1),
      question_id: "q2",
      session_id: "other",
    });

    expect((await getKcLearning(COURSE))[NOZZLE]).toBeUndefined();
  });

  test("schedules a KC taught in a session that still runs, not strong when answered wrong today", async () => {
    // Early in the UTC day, so a whole day passes before its end, where the
    // band reads recall.
    db.tables.attempts.push({
      ...attempt(EFFICIENCY, 0, false),
      created_at: `${day(0)}T00:01:00.000Z`,
      session_id: OPEN_SESSION,
    });

    expect((await getKcLearning(COURSE))[EFFICIENCY]).toMatchObject({
      band: "fading",
      nextReview: day(1),
    });
  });
});

describe("getStudyState", () => {
  const brief = () =>
    db.tables.briefs.push({
      course_id: COURSE,
      exam_date: day(21),
      goal: null,
    });

  test("ranks the due Review, then the next Topic, with Progress and Readiness", async () => {
    brief();

    const state = await getStudyState(COURSE);
    // Efficiency has no Priority, so t1's untaught work is worth nothing.
    expect(state.ranking).toEqual([
      {
        kind: "review",
        id: THRUST,
        name: "Thrust equation",
        centralQuestion: null,
        minutes: 2,
      },
      {
        kind: "topic",
        id: "t2",
        name: "Nozzles",
        centralQuestion: "What does a nozzle do?",
        minutes: 30,
      },
    ]);
    expect(state).toMatchObject({
      hasMap: true,
      hasTopics: true,
      examDate: day(21),
      finalStretch: false,
      taught: true,
      // Thrust is learned; the first attempt was 6 days ago.
      progress: { learned: 1, total: 3, daysIn: 7, daysLeft: 21 },
      readiness: { onTheDay: true },
      topics: {
        t1: { learned: 1, total: 2, readiness: expect.any(Number) },
        t2: { learned: 0, total: 1, readiness: 0 },
      },
    });
    // Thrust weighs 0.8 against Nozzle's untaught 0.1.
    expect(state.readiness.course).toBeCloseTo(
      (0.8 * state.topics.t1!.readiness!) / 0.9,
    );
  });

  test("reads the Student's skips and pins", async () => {
    brief();
    const pinnedAt = at(-1);
    choices = [
      { topicId: "t1", choice: "skipped", createdAt: pinnedAt },
      { topicId: "t2", choice: "pinned", createdAt: pinnedAt },
    ];

    const state = await getStudyState(COURSE);
    expect(state.ranking.map((item) => item.id)).toEqual(["t2"]);
    expect(state.scope).toEqual([
      { id: "t1", status: "skipped", pinnedAt: null },
      { id: "t2", status: "in_plan", pinnedAt },
    ]);
  });

  test("gives the latest graded mock's score over its graded items", async () => {
    db.tables.mock_exams.push(
      { id: "m1", course_id: COURSE, status: "graded", graded_at: at(-3) },
      { id: "m2", course_id: COURSE, status: "graded", graded_at: at(-1) },
      { id: "m3", course_id: COURSE, status: "ready", graded_at: null },
    );
    db.tables.mock_items.push(
      { mock_id: "m1", points: 4, points_awarded: 4 },
      { mock_id: "m2", points: 4, points_awarded: 3 },
      { mock_id: "m2", points: 6, points_awarded: null },
    );

    expect((await getStudyState(COURSE)).lastMockPercent).toBe(75);
  });

  test("measures the pace from 3 ended teaching sessions' messages", async () => {
    // Six active minutes each, teaching one KC: 4 between the Student's
    // messages and 2 to the AI's last reply.
    [PRIOR, EFFICIENCY, NOZZLE].forEach((kcId, i) => {
      const [session, chat] = [`s${i}`, `c${i}`];
      const start = -3 + i;
      db.tables.study_sessions.push({
        id: session,
        course_id: COURSE,
        chat_id: chat,
        ended_at: at(start + 0.1),
      });
      db.tables.questions.push({ id: `q${i}`, session_id: session });
      db.tables.attempts.push({
        ...attempt(kcId, start),
        question_id: `q${i}`,
        session_id: session,
      });
      db.tables.chat_messages.push(
        ...[
          ["user", 0],
          ["assistant", 1],
          ["user", 4],
          ["assistant", 6],
        ].map(([role, minutes]) => ({
          id: randomUUID(),
          chat_id: chat,
          role,
          created_at: at(start + (minutes as number) / 1440),
        })),
      );
    });

    expect((await getStudyState(COURSE)).pace).toEqual({
      minutesPerKc: expect.closeTo(6, 5),
      minutesPerReview: 2,
    });
  });

  test("has no map without one", async () => {
    map = EMPTY_MAP;

    expect(await getStudyState(COURSE)).toMatchObject({
      hasMap: false,
      taught: false,
    });
  });

  test("is empty for another Student's Course", async () => {
    expect(await getStudyState(OTHER_COURSE)).toMatchObject({
      hasTopics: false,
      ranking: [],
      scope: [],
      topics: {},
    });
  });
});
