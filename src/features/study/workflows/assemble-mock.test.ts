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
const DAY_MS = 24 * 60 * 60 * 1000;

const TABLES = [
  "mock_exams",
  "mock_items",
  "problems",
  "problem_kcs",
  "materials",
  "chunks",
  "exercise_solutions",
  "big_ideas",
  "kcs",
  "kc_sources",
  "prerequisite_links",
  "exercises",
  "exercise_kcs",
  "findings",
  "finding_sources",
  "knowledge_map_builds",
  "topics",
  "topic_kcs",
  "topic_choices",
  "study_sessions",
  "questions",
  "attempts",
  "chats",
  "chat_messages",
  "briefs",
  "brief_excluded_materials",
  "ai_usage",
] as const;

function createDb() {
  return fakeSupabase({
    tables: Object.fromEntries(
      TABLES.map((table) => [table, [] as FakeRow[]]),
    ) as Record<(typeof TABLES)[number], FakeRow[]>,
    foreignKeys: {
      problem_kcs: { problem_id: "problems" },
      topic_kcs: { topic_id: "topics" },
      mock_items: { mock_id: "mock_exams" },
      questions: { session_id: "study_sessions" },
    },
    defaults: {
      problems: () => ({
        created_at: new Date().toISOString(),
        statement: null,
        solution: null,
        program: null,
        final_answers: null,
        failure: null,
        flag: null,
      }),
      ai_usage: () => ({ created_at: new Date().toISOString() }),
    },
    functions: {
      // As the real function: the open mock, or a new assembling one.
      queue_mock_exam: (args, tables) => {
        const open = tables.mock_exams.find((m) => m.status !== "failed");
        if (open) return [{ mock_id: open.id, queued: false }];
        tables.mock_exams.push(assembling(String(args.p_course_id)));
        return [{ mock_id: MOCK, queued: true }];
      },
    },
  });
}

const assembling = (courseId = COURSE): FakeRow => ({
  id: MOCK,
  owner: STUDENT,
  course_id: courseId,
  status: "assembling",
  reserved_material_id: null,
  gaps_total: 0,
  gaps_done: 0,
  failure: null,
  created_at: new Date().toISOString(),
});

let db = createDb();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));
const startWorkflow = vi.fn(async () => ({}));
vi.mock("workflow/api", () => ({ start: startWorkflow }));

const { assembleMock } = await import("./assemble-mock");
const { queueMockAssembly } =
  await import("@/features/study/server/mock-assembly");

beforeEach(() => {
  db = createDb();
  startWorkflow.mockClear();
});

const DRAFT = {
  change: "new_values",
  statement: "A turbojet takes in {{mass_flow}}. Compute the thrust.",
  solution: "The thrust is {{thrust_kN}}.",
  program: "mass_flow = 50 kg/s\nthrust_kN = to(mass_flow * 350 m/s, kN)",
  finalAnswers: [{ variable: "thrust_kN", unit: "kN" }],
};

function useGenerateModel(answer: object | Error) {
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      if (answer instanceof Error) throw answer;
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
  useMockModels({ generate: model });
  return model;
}

const owned = { owner: STUDENT, course_id: COURSE };

/**
 * Topic t1 tests k1, t2 tests k2. Exercise x1 (k1) is unseen, x2 (k2) was
 * asked three days ago; both in Material m1.
 */
function seedCourse({ exam = false }: { exam?: boolean } = {}) {
  const t = db.tables;
  t.knowledge_map_builds.push({ ...owned, finished_at: "2026-10-01T00:00Z" });
  t.materials.push({
    id: "m1",
    ...owned,
    name: "Exam 2025",
    is_exam: exam,
    created_at: "2026-10-01T00:00:00Z",
  });
  t.big_ideas.push({
    id: "b1",
    ...owned,
    name: "Thrust",
    description: "Thrust.",
    position: 0,
  });
  ["k1", "k2"].forEach((id, position) => {
    t.kcs.push({
      id,
      ...owned,
      big_idea_id: "b1",
      name: `KC ${id}`,
      description: `${id}.`,
      type: "concept",
      origin: "content",
      position,
    });
    t.topics.push({
      id: `t${position + 1}`,
      ...owned,
      big_idea_id: "b1",
      name: `Topic ${position + 1}`,
      central_question: "Why?",
      position,
    });
    t.topic_kcs.push({
      topic_id: `t${position + 1}`,
      kc_id: id,
      owner: STUDENT,
      position: 0,
    });
  });
  const exercise = (id: string, kc: string, position: number) => {
    t.chunks.push({
      id: `cccccccc-0000-4000-8000-00000000000${position}`,
      ...owned,
      material_id: "m1",
      position,
      page_from: 1,
      page_to: 1,
      markdown: `Question ${id}.`,
    });
    t.exercises.push({
      id,
      ...owned,
      question_chunk_id: `cccccccc-0000-4000-8000-00000000000${position}`,
      difficulty: 2,
      position,
      final_answers: null,
    });
    t.exercise_kcs.push({ ...owned, exercise_id: id, kc_id: kc });
  };
  exercise("x1", "k1", 0);
  exercise("x2", "k2", 1);
  const at = new Date(Date.now() - 3 * DAY_MS).toISOString();
  t.study_sessions.push({ id: "s0", ...owned, chat_id: null, ended_at: at });
  t.questions.push({
    id: "q0",
    owner: STUDENT,
    session_id: "s0",
    exercise_id: "x2",
    problem_id: null,
    kind: "question",
    confidence: null,
    asked_at: at,
    answered_at: at,
  });
  t.mock_exams.push(assembling());
}

const mock = () => db.tables.mock_exams[0]!;
const items = () =>
  db.tables.mock_items.toSorted(
    (a, b) => Number(a.position) - Number(b.position),
  );

test("fills slots from unseen Exercises, generates up to 6 gaps, and lasts its items' minutes", async () => {
  seedCourse();
  useGenerateModel(DRAFT);

  await assembleMock(MOCK);

  expect(mock()).toMatchObject({
    status: "ready",
    gaps_total: 6,
    gaps_done: 6,
  });
  const stored = items();
  expect(stored).toHaveLength(7);
  expect(stored.filter((i) => i.exercise_id !== null)).toMatchObject([
    { exercise_id: "x1", topic_id: "t1", prompt: "Question x1.", points: 12 },
  ]);
  const generated = stored.filter((i) => i.problem_id !== null);
  for (const item of generated) {
    const problem = db.tables.problems.find((p) => p.id === item.problem_id)!;
    expect(problem).toMatchObject({ status: "ready", topic_id: item.topic_id });
    expect(item.prompt).toBe(problem.statement);
  }
  // A variant of the seen x2 for t2; t1 gets new Problems, as x1 is unseen.
  expect(
    db.tables.problems.filter((p) => p.source === "variant"),
  ).toMatchObject([{ original_exercise_id: "x2", topic_id: "t2" }]);
  expect(mock().duration_minutes).toBe(
    stored.reduce((sum, i) => sum + Number(i.points), 0),
  );
  // Nothing is recalled yet, so nothing is predicted.
  expect(mock().predicted_score).toBe(0);
});

test("a reached Daily limit drops the slots not yet generated", async () => {
  vi.stubEnv("AI_DAILY_LIMIT_USD", "0.0000001");
  seedCourse();
  const model = useGenerateModel(DRAFT);

  await assembleMock(MOCK);

  expect(model.doGenerateCalls).toHaveLength(1);
  expect(mock()).toMatchObject({ status: "ready", gaps_done: 1 });
  expect(items()).toHaveLength(2);
  expect(mock().duration_minutes).toBe(
    items().reduce((sum, i) => sum + Number(i.points), 0),
  );
  vi.unstubAllEnvs();
});

test("a mock without items left fails with the reason", async () => {
  seedCourse();
  db.tables.exercises = db.tables.exercises.filter((e) => e.id !== "x1");
  vi.spyOn(console, "error").mockImplementation(() => {});
  useGenerateModel(new Error("Provider down"));

  await assembleMock(MOCK);

  expect(mock()).toMatchObject({
    status: "failed",
    failure: "No problems could be found or generated for your Topics.",
  });
  expect(items()).toEqual([]);
});

test("in the final week with a reservation, the mock is that exam's Exercises in order", async () => {
  seedCourse({ exam: true });
  db.tables.briefs.push({
    ...owned,
    exam_date: new Date(Date.now() + 3 * DAY_MS).toISOString().slice(0, 10),
    reserved_exam_material_id: "m1",
  });
  const model = useGenerateModel(DRAFT);

  await assembleMock(MOCK);

  expect(model.doGenerateCalls).toHaveLength(0);
  expect(mock()).toMatchObject({
    status: "ready",
    reserved_material_id: "m1",
    duration_minutes: 24,
  });
  expect(items().map((i) => i.exercise_id)).toEqual(["x1", "x2"]);
});

test("Mock exam opens the open mock instead of assembling another", async () => {
  const supabase = db as unknown as Supabase;

  expect(await queueMockAssembly(supabase, COURSE)).toBe(MOCK);
  expect(await queueMockAssembly(supabase, COURSE)).toBe(MOCK);

  expect(startWorkflow).toHaveBeenCalledTimes(1);
  expect(db.tables.mock_exams).toHaveLength(1);
});
