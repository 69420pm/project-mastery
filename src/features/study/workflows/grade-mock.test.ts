// @vitest-environment node
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, expect, test, vi } from "vitest";
import { useMockModels } from "@/lib/ai/testing";
import { markAdminClient } from "@/lib/supabase/admin-brand";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";
import type { Supabase } from "@/lib/supabase/types";

vi.mock("server-only", () => ({}));

const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const STUDENT = "11111111-1111-1111-1111-111111111111";
const MOCK = "eeeeeeee-0000-4000-8000-000000000001";

const TABLES = [
  "mock_exams",
  "mock_items",
  "questions",
  "question_kcs",
  "attempts",
  "kcs",
  "exercises",
  "chunks",
  "problems",
  "ai_usage",
] as const;

function createDb() {
  return fakeSupabase({
    tables: Object.fromEntries(
      TABLES.map((table) => [table, [] as FakeRow[]]),
    ) as Record<(typeof TABLES)[number], FakeRow[]>,
    defaults: {
      ai_usage: () => ({ created_at: new Date().toISOString() }),
      attempts: () => ({ created_at: new Date().toISOString() }),
    },
  });
}

let db = createDb();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));

const { gradeMock } = await import("./grade-mock");

/** Answers each grade_exam call with the next grading, or throws an Error. */
function useGradeModel(...answers: Array<object | Error>) {
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      const answer = answers.shift();
      if (!answer || answer instanceof Error) throw answer ?? new Error("None");
      return {
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
      };
    },
  });
  useMockModels({ grade_exam: model });
  return model;
}

/**
 * A submitted mock of three items: Exercise x1 on k1 with key 17.5 kN
 * (answered), a blank Problem p1 on k1 and k2, and Problem p2 on k2
 * (answered).
 */
function seedMock() {
  const t = db.tables;
  t.mock_exams.push({
    id: MOCK,
    owner: STUDENT,
    course_id: COURSE,
    status: "submitted",
    session_id: "s1",
    score: null,
    brier: null,
    graded_at: null,
  });
  for (const id of ["k1", "k2"]) {
    t.kcs.push({ id, name: `KC ${id}`, description: `${id}.` });
  }
  t.exercises.push({
    id: "x1",
    question_chunk_id: "c1",
    solution_chunk_id: null,
    final_answers: [{ label: "F", value: 17.5, unit: "kN" }],
  });
  t.problems.push(
    { id: "p1", solution: "Stages.", final_answers: null },
    { id: "p2", solution: "Nozzle.", final_answers: null },
  );
  const items = [
    {
      source: { exercise_id: "x1", problem_id: null },
      kcs: ["k1"],
      answer: "17.5 kN",
      points: 6,
      predicted: 0.5,
    },
    {
      source: { exercise_id: null, problem_id: "p1" },
      kcs: ["k1", "k2"],
      answer: null,
      points: 4,
      predicted: 0.5,
    },
    {
      source: { exercise_id: null, problem_id: "p2" },
      kcs: ["k2"],
      answer: "Converging.",
      points: 4,
      predicted: 0.5,
    },
  ];
  items.forEach((item, position) => {
    t.questions.push({
      id: `q${position}`,
      session_id: "s1",
      answer_text: item.answer,
      graded_at: null,
    });
    for (const kc of item.kcs) {
      t.question_kcs.push({ question_id: `q${position}`, kc_id: kc });
    }
    t.mock_items.push({
      id: `i${position}`,
      mock_id: MOCK,
      owner: STUDENT,
      position,
      ...item.source,
      prompt: `Task ${position}.`,
      points: item.points,
      predicted_success: item.predicted,
      question_id: `q${position}`,
      points_awarded: null,
      steps: null,
      check: null,
      graded_at: null,
    });
  });
}

const grading = (
  points: number,
  finalValue: string | null,
  result = "full",
) => ({
  steps: [{ points, reason: "Right." }],
  results: { K1: result },
  finalValue,
});

const item = (id: string) => db.tables.mock_items.find((i) => i.id === id)!;
const attemptsOf = (questionId: string) =>
  db.tables.attempts
    .filter((a) => a.question_id === questionId)
    .map(({ kc_id, kind, result, help, check }) => ({
      kc_id,
      kind,
      result,
      help,
      check,
    }));

beforeEach(() => {
  db = createDb();
  seedMock();
});

test("grades each item, a blank one without a call, and makes the mock graded", async () => {
  // x1's final value misses its key: capped at 5 points, full becomes partial.
  const model = useGradeModel(grading(6, "20 kN"), grading(3, null));

  await gradeMock(MOCK);

  expect(model.doGenerateCalls).toHaveLength(2);
  expect(item("i0")).toMatchObject({ points_awarded: 5, check: "mismatch" });
  expect(item("i1")).toMatchObject({ points_awarded: 0, steps: [] });
  expect(item("i2")).toMatchObject({ points_awarded: 3, check: null });
  expect(attemptsOf("q0")).toEqual([
    {
      kc_id: "k1",
      kind: "mock",
      result: "partial",
      help: "none",
      check: "mismatch",
    },
  ]);
  expect(attemptsOf("q1").map((a) => [a.kc_id, a.result])).toEqual([
    ["k1", "wrong"],
    ["k2", "wrong"],
  ]);
  expect(db.tables.questions.every((q) => q.graded_at !== null)).toBe(true);
  expect(db.tables.mock_exams[0]).toMatchObject({
    status: "graded",
    score: 8,
    // ((0.5 − 5/6)² + 0.5² + (0.5 − 3/4)²) / 3
    brier: expect.closeTo(0.1412, 4),
  });
});

test("a rerun skips the items already graded", async () => {
  Object.assign(item("i0"), {
    points_awarded: 6,
    steps: [],
    graded_at: "2026-10-26T10:00:00Z",
  });
  db.tables.questions[0]!.graded_at = "2026-10-26T10:00:00Z";
  const model = useGradeModel(grading(4, null));

  await gradeMock(MOCK);

  expect(model.doGenerateCalls).toHaveLength(1);
  expect(attemptsOf("q0")).toEqual([]);
  expect(db.tables.mock_exams[0]).toMatchObject({
    status: "graded",
    score: 10,
  });
});

test("an item that cannot be graded is left out, and the mock still ends graded", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  useGradeModel(new Error("Provider down"), grading(4, null));

  await gradeMock(MOCK);

  expect(item("i0")).toMatchObject({ points_awarded: null });
  expect(item("i0").graded_at).not.toBeNull();
  expect(attemptsOf("q0")).toEqual([]);
  expect(db.tables.mock_exams[0]).toMatchObject({
    status: "graded",
    score: 4,
    // (0.5² + 0.5²) / 2
    brier: 0.25,
  });
});
