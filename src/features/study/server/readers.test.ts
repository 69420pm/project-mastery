// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TopicChoice } from "@/features/study/domain/plan";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

/**
 * The map page's study reads: KC learning, KC states, the plan and its
 * Today plan. The stored map is given; Priorities, the Brief and
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
const OPEN_SESSION = "aaaaaaaa-5000-4000-8000-000000000002";
const CHAT = "aaaaaaaa-c400-4000-8000-000000000001";
const QUESTION = "aaaaaaaa-9000-4000-8000-000000000001";
const EMPTY_MAP = { bigIdeas: [], kcs: [], prerequisites: [], exercises: [] };

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
      kc_priorities: [
        { course_id: COURSE, kc_id: THRUST, priority: "0.8" },
        { course_id: COURSE, kc_id: NOZZLE, priority: "0.1" },
      ] as FakeRow[],
      study_sessions: [
        // Ended four days ago; the other one's Chat had a message just now.
        { id: SESSION, course_id: COURSE, chat_id: null, ended_at: at(-4) },
        { id: OPEN_SESSION, course_id: COURSE, chat_id: CHAT, ended_at: null },
      ] as FakeRow[],
      chats: [{ id: CHAT, last_message_at: at(0) }],
      chat_messages: [] as FakeRow[],
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

const { getKcLearning, getKcStates, getPlan, getTopicStates } =
  await import("@/features/study/server");

/** A stored `learn` attempt on a KC `days` from now, in the ended session. */
const attempt = (kcId: string, days: number, correct = true): FakeRow => ({
  id: randomUUID(),
  question_id: QUESTION,
  session_id: SESSION,
  kc_id: kcId,
  kind: "learn",
  result: correct ? "full" : "wrong",
  help: "none",
  created_at: at(days),
});

beforeEach(() => {
  signedIn = true;
  choices = [];
  map = MAP;
  db = createDb();
  // Stored newest first: the readers order them by time. The session's last
  // answer, a Good, creates the card due three days later.
  db.tables.attempts.push(attempt(THRUST, -5), attempt(THRUST, -6, false));
});

describe.each([
  ["signed out", COURSE, false],
  ["a malformed id", "not-a-uuid", true],
])("%s", (_, courseId, user) => {
  test("gives no learning, states or plan", async () => {
    signedIn = user;

    expect(await getKcLearning(courseId)).toEqual({});
    expect(await getKcStates(courseId)).toEqual({});
    expect(await getTopicStates(courseId)).toEqual({});
    expect(await getPlan(courseId)).toEqual({
      phase: null,
      topics: [],
      order: [],
      fit: null,
      hoursPerWeek: null,
      pace: { minutesPerKc: 30, minutesPerReview: 2 },
      hasMap: false,
      today: { reviews: null, next: null, hint: null },
    });
  });
});

describe("getKcLearning", () => {
  test("replays a taught KC's attempts to its state, newest first", async () => {
    const learning = await getKcLearning(COURSE);

    expect(learning[THRUST]).toEqual({
      state: "due",
      nextReview: day(-2),
      retrievability: expect.closeTo(0.85, 1),
      attempts: db.tables.attempts.map((row) => ({
        createdAt: row.created_at,
        result: row.result,
        help: "none",
        exerciseId: null,
      })),
    });
  });

  test("reads only the Course's sessions, and a partial answer as Hard", async () => {
    db.tables.study_sessions.push({
      id: "other",
      course_id: "other-course",
      ended_at: at(-1),
    });
    db.tables.questions.push({ id: "q2", session_id: "other" });
    db.tables.attempts.push(
      { ...attempt(NOZZLE, -1), question_id: "q2", session_id: "other" },
      { ...attempt(THRUST, -4.5), result: "partial" },
    );

    const learning = await getKcLearning(COURSE);

    expect(learning[NOZZLE]).toBeUndefined();
    // Hard on a new card gives two days.
    expect(learning[THRUST]).toMatchObject({ nextReview: day(-2.5) });
  });

  test("keeps a KC learning without a next review while its first session runs", async () => {
    db.tables.attempts.push({
      ...attempt(EFFICIENCY, 0),
      session_id: OPEN_SESSION,
    });
    // A prequestion leaves a KC new.
    db.tables.attempts.push({ ...attempt(NOZZLE, -1), kind: "pre" });

    const learning = await getKcLearning(COURSE);

    expect(learning[EFFICIENCY]).toMatchObject({
      state: "learning",
      nextReview: null,
      retrievability: null,
    });
    expect(learning[NOZZLE]).toMatchObject({
      state: "new",
      attempts: [expect.objectContaining({ result: "full" })],
    });
  });

  test("ends a session after 2 hours without a message", async () => {
    db.tables.chats[0]!.last_message_at = at(-0.1);
    db.tables.attempts.push({
      ...attempt(EFFICIENCY, -0.11),
      session_id: OPEN_SESSION,
    });

    const learning = await getKcLearning(COURSE);

    expect(learning[EFFICIENCY]).toMatchObject({ nextReview: day(2.89) });
  });

  test("lists only KCs with attempts", async () => {
    expect(Object.keys(await getKcLearning(COURSE))).toEqual([THRUST]);
  });
});

describe("getKcStates", () => {
  test("gives each taught KC its replayed state", async () => {
    db.tables.attempts.push({
      ...attempt(EFFICIENCY, 0, false),
      session_id: OPEN_SESSION,
    });

    expect(await getKcStates(COURSE)).toEqual({
      [THRUST]: {
        state: "due",
        nextReview: day(-2),
        retrievability: expect.any(Number),
      },
      [EFFICIENCY]: {
        state: "learning",
        nextReview: null,
        retrievability: null,
      },
    });
  });
});

describe("getTopicStates", () => {
  test("gives each Topic its state and recall today", async () => {
    expect(await getTopicStates(COURSE)).toEqual({
      // The taught KC's recall, with the untaught one counting as 0.
      t1: { state: "in_progress", recall: expect.closeTo(0.85 / 2, 1) },
      t2: { state: "new", recall: 0 },
    });
  });

  test("is empty for another Student's Course", async () => {
    expect(
      await getTopicStates("bbbbbbbb-c000-4000-8000-000000000001"),
    ).toEqual({});
  });
});

describe("getPlan", () => {
  const brief = (hoursPerWeek: string) =>
    db.tables.briefs.push({
      course_id: COURSE,
      exam_date: day(21),
      hours_per_week: hoursPerWeek,
      goal: null,
    });

  test("gives the Topic plan with its fit and the weekly hours", async () => {
    brief("10");

    const plan = await getPlan(COURSE);
    expect(plan).toMatchObject({
      phase: "build",
      // t1 is in progress, with Thrust taught.
      order: ["t1", "t2"],
      fit: { fitting: 2, inPlan: 2, examWeight: 100 },
      hoursPerWeek: 10,
    });
    expect(plan.topics).toMatchObject([
      { id: "t1", priority: 0.8, untaught: [EFFICIENCY], fits: true },
      { id: "t2", priority: 0.1, untaught: [NOZZLE], fits: true },
    ]);
  });

  test("reads the Student's skips and pins", async () => {
    brief("10");
    choices = [
      { topicId: "t1", choice: "skipped", createdAt: at(-1) },
      { topicId: "t2", choice: "pinned", createdAt: at(-1) },
    ];

    const plan = await getPlan(COURSE);
    expect(plan.order).toEqual(["t2"]);
    expect(plan.topics).toMatchObject([
      { id: "t1", status: "skipped" },
      { id: "t2", status: "in_plan", pinned: true },
    ]);
    // The Today card names the pinned Topic, not the skipped one.
    expect(plan.today.next?.id).toBe("t2");
  });

  test("leaves out what the weekly hours don't fit", async () => {
    brief("0.01");

    expect((await getPlan(COURSE)).fit).toEqual({
      fitting: 0,
      inPlan: 2,
      examWeight: 0,
    });
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

    expect((await getPlan(COURSE)).pace).toEqual({
      minutesPerKc: expect.closeTo(6, 5),
      minutesPerReview: 2,
    });
  });

  test("has no Phase without an exam date", async () => {
    expect(await getPlan(COURSE)).toMatchObject({ phase: null, fit: null });
  });

  test("is empty for another Student's Course", async () => {
    expect(await getPlan("bbbbbbbb-c000-4000-8000-000000000001")).toMatchObject(
      { phase: null, topics: [], order: [], fit: null },
    );
  });
});

describe("the Today plan", () => {
  test("gives the due reviews in minutes and the next Topic", async () => {
    expect(await getPlan(COURSE)).toMatchObject({
      hasMap: true,
      today: {
        reviews: { count: 1, minutes: 2 },
        next: {
          id: "t1",
          name: "Thrust",
          centralQuestion: "How is thrust made?",
          kcs: [THRUST, EFFICIENCY],
        },
        hint: null,
      },
    });
  });

  test("has no map without one", async () => {
    map = EMPTY_MAP;

    expect(await getPlan(COURSE)).toMatchObject({
      hasMap: false,
      today: { reviews: null },
    });
  });

  test("is empty for another Student's Course", async () => {
    expect(
      (await getPlan("bbbbbbbb-c000-4000-8000-000000000001")).today,
    ).toEqual({ reviews: null, next: null, hint: null });
  });
});
