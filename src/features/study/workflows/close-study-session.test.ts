// @vitest-environment node
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, expect, test, vi } from "vitest";
import { useMockModels } from "@/lib/ai/testing";
import { markAdminClient } from "@/lib/supabase/admin-brand";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";
import type { Supabase } from "@/lib/supabase/types";

vi.mock("server-only", () => ({}));

const STUDENT = "11111111-1111-1111-1111-111111111111";
const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const PIN = "!Exam is open book.";

const TABLES = [
  "study_sessions",
  "chat_messages",
  "topics",
  "topic_notes",
  "questions",
  "attempts",
  "kcs",
  "memories",
  "ai_usage",
] as const;

/** The arguments of each `store_session_close` call. */
let stored: Array<Record<string, unknown>> = [];

function createDb() {
  return fakeSupabase({
    tables: Object.fromEntries(
      TABLES.map((table) => [table, [] as FakeRow[]]),
    ) as Record<(typeof TABLES)[number], FakeRow[]>,
    defaults: {
      ai_usage: () => ({ created_at: new Date().toISOString() }),
    },
    functions: {
      // Its transaction and guard are tested with pgTAP; this one stores the
      // Session note and records the arguments.
      store_session_close: (args, tables) => {
        stored.push(args);
        const session = tables.study_sessions.find(
          ({ id }) => id === args.p_session_id,
        )!;
        session.session_note = args.p_session_note;
        return true;
      },
    },
  });
}

let db = createDb();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));

const { closeStudySession } = await import("./close-study-session");

/** Answers each close call with `answer`. */
function useCloseModel(answer: object) {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(answer) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: 10,
          noCache: 10,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    }),
  });
  useMockModels({ close: model });
  return model;
}

/** An ended learn session on Topic t1 with one graded Question. */
function seedSession(overrides: FakeRow = {}) {
  const t = db.tables;
  t.study_sessions.push({
    id: "s1",
    owner: STUDENT,
    course_id: COURSE,
    chat_id: "c1",
    mode: "learn",
    topic_id: "t1",
    ended_at: "2026-10-26T10:00:00Z",
    close_started_at: null,
    session_note: null,
    ...overrides,
  });
  t.topics.push({ id: "t1", name: "Thrust" });
  t.topic_notes.push({ topic_id: "t1", text: "Mixes up mass flow." });
  t.chat_messages.push(
    {
      chat_id: "c1",
      role: "user",
      parts: [{ type: "text", text: "Teach me thrust." }],
      created_at: "2026-10-26T09:00:00Z",
    },
    {
      chat_id: "c1",
      role: "assistant",
      parts: [{ type: "text", text: "Thrust is ṁ Δv." }],
      created_at: "2026-10-26T09:01:00Z",
    },
  );
  t.questions.push({
    id: "q1",
    session_id: "s1",
    prompt: "Why?",
    answer_text: "Velocity.",
    asked_at: "2026-10-26T09:02:00Z",
  });
  t.kcs.push({ id: "k1", name: "Momentum thrust" });
  t.attempts.push({
    question_id: "q1",
    session_id: "s1",
    kc_id: "k1",
    result: "partial",
    help: "hint",
  });
  t.memories.push({
    course_id: COURSE,
    text: `${PIN}\n${"Likes short answers. ".repeat(150)}`,
    updated_at: "2026-10-25T08:00:00.123456+00:00",
  });
}

const session = () => db.tables.study_sessions[0]!;

const ANSWER = {
  sessionNote: "Learned momentum thrust.\nNext: nozzles.",
  topicNote: "Still says velocity alone makes thrust.",
  memoryLines: ["Prefers worked examples."],
  condensedMemory: "Likes short answers.",
};

beforeEach(() => {
  db = createDb();
  stored = [];
});

test("a claimed session closes once with one call, and a second start stops at the claim", async () => {
  const model = useCloseModel(ANSWER);
  seedSession();

  await closeStudySession("s1");
  await closeStudySession("s1");

  expect(model.doGenerateCalls).toHaveLength(1);
  const input = JSON.stringify(model.doGenerateCalls[0]!.prompt);
  for (const part of [
    "Thrust is ṁ Δv.",
    "Momentum thrust",
    "Mixes up mass flow.",
  ]) {
    expect(input).toContain(part);
  }
  expect(session().close_started_at).not.toBeNull();
  // The condensed Memory lost the pinned line, so it is not stored.
  expect(stored).toEqual([
    {
      p_session_id: "s1",
      p_session_note: ANSWER.sessionNote,
      p_memory_lines: ANSWER.memoryLines,
      p_topic_note: ANSWER.topicNote,
    },
  ]);
  expect(db.tables.ai_usage).toHaveLength(1);
});

test("a condensed Memory that keeps the pinned lines is stored with the Memory's read time", async () => {
  useCloseModel({ ...ANSWER, condensedMemory: `${PIN}\nLikes short answers.` });
  seedSession();

  await closeStudySession("s1");

  expect(stored[0]).toMatchObject({
    p_condensed_memory: `${PIN}\nLikes short answers.`,
    p_memory_read_at: "2026-10-25T08:00:00.123456+00:00",
  });
});

test("a session claimed already or still running gets no call", async () => {
  const model = useCloseModel(ANSWER);
  seedSession({ close_started_at: "2026-10-26T10:00:01Z" });

  await closeStudySession("s1");
  session().close_started_at = null;
  session().ended_at = null;
  await closeStudySession("s1");

  expect(model.doGenerateCalls).toHaveLength(0);
  expect(stored).toEqual([]);
});

test.each([
  ["without a Student message", { chat_id: "c1" }, "user"],
  ["without a Chat (a mock)", { chat_id: null, mode: "mock" }, "none"],
])(
  "a session %s stays claimed with no call and no note",
  async (_, overrides, dropRole) => {
    const model = useCloseModel(ANSWER);
    seedSession(overrides);
    db.tables.chat_messages = db.tables.chat_messages.filter(
      ({ role }) => role !== dropRole,
    );

    await closeStudySession("s1");

    expect(model.doGenerateCalls).toHaveLength(0);
    expect(session().close_started_at).not.toBeNull();
    expect(session().session_note).toBeNull();
  },
);
