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

const TABLES = [
  "study_sessions",
  "chat_messages",
  "questions",
  "attempts",
  "kcs",
  "topic_kcs",
  "topics",
  "topic_notes",
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
      // Its transaction and guard are tested with pgTAP; this one marks the
      // session closed and records the arguments.
      store_session_close: (args, tables) => {
        stored.push(args);
        const session = tables.study_sessions.find(
          ({ id }) => id === args.p_session_id,
        )!;
        session.closed_at = new Date().toISOString();
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

/** An ended session with one graded Question. */
function seedSession(overrides: FakeRow = {}) {
  const t = db.tables;
  t.study_sessions.push({
    id: "s1",
    owner: STUDENT,
    course_id: COURSE,
    chat_id: "c1",
    ended_at: "2026-10-26T10:00:00Z",
    close_started_at: null,
    closed_at: null,
    ...overrides,
  });
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
  t.topic_kcs.push({ topic_id: "t1", kc_id: "k1" });
  t.topics.push(
    { id: "t1", name: "Thrust", position: 0 },
    { id: "t2", name: "Nozzles", position: 1 },
  );
  t.topic_notes.push({ topic_id: "t1", text: "Mixes up mass flow." });
  t.attempts.push({
    question_id: "q1",
    session_id: "s1",
    kc_id: "k1",
    result: "partial",
    help: "hint",
  });
  t.memories.push({
    course_id: COURSE,
    text: "Likes short answers. ".repeat(150),
    updated_at: "2026-10-25T08:00:00.123456+00:00",
  });
}

const session = () => db.tables.study_sessions[0]!;

const ANSWER = {
  topicNotes: [
    { topicId: "t1", text: "Needed a hint on Δv." },
    { topicId: "t2", text: "Not touched." },
  ],
  memoryLines: ["Prefers worked examples."],
  condensedLines: ["Likes short answers."],
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
    "Velocity.",
    "Mixes up mass flow.",
  ]) {
    expect(input).toContain(part);
  }
  expect(input).not.toContain("Nozzles");
  expect(session().close_started_at).not.toBeNull();
  expect(stored).toEqual([
    {
      p_session_id: "s1",
      p_memory_lines: ANSWER.memoryLines,
      p_topic_notes: [{ topic_id: "t1", text: "Needed a hint on Δv." }],
      p_condensed_memory: "Likes short answers.",
      p_memory_read_at: "2026-10-25T08:00:00.123456+00:00",
    },
  ]);
  expect(db.tables.ai_usage).toHaveLength(1);
});

test("a session without Attempts writes Memory lines only", async () => {
  useCloseModel(ANSWER);
  seedSession();
  db.tables.attempts = [];

  await closeStudySession("s1");

  expect(stored).toMatchObject([
    { p_memory_lines: ANSWER.memoryLines, p_topic_notes: [] },
  ]);
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
  ["without a Chat (a mock)", { chat_id: null }, "none"],
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
    expect(stored).toEqual([]);
  },
);
