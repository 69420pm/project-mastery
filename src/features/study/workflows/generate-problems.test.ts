// @vitest-environment node
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useMockModels } from "@/lib/ai/testing";
import { markAdminClient } from "@/lib/supabase/admin-brand";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";
import type { Supabase } from "@/lib/supabase/types";

vi.mock("server-only", () => ({}));

const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const STUDENT = "11111111-1111-1111-1111-111111111111";
const TOPIC = "dddddddd-0000-4000-8000-000000000001";
const QUESTION_CHUNK = "cccccccc-0000-4000-8000-000000000001";
const DAY_MS = 24 * 60 * 60 * 1000;

const TABLES = [
  "problem_runs",
  "problems",
  "problem_kcs",
  "materials",
  "chunks",
  "exercise_solutions",
  "big_ideas",
  "kcs",
  "kc_sources",
  "prerequisite_links",
  "semantic_links",
  "exercises",
  "exercise_kcs",
  "findings",
  "finding_sources",
  "knowledge_map_builds",
  "topics",
  "topic_kcs",
  "study_sessions",
  "questions",
  "attempts",
  "chats",
  "briefs",
  "mock_exams",
  "kc_priorities",
  "ai_usage",
] as const;

/** Queued Problems are created on 2026-10-25, in order; seeded ones before. */
let createdAt = 0;
function createDb() {
  const now = () => new Date(Date.UTC(2026, 9, 25) + createdAt++).toISOString();
  return fakeSupabase({
    tables: Object.fromEntries(
      TABLES.map((table) => [table, [] as FakeRow[]]),
    ) as Record<(typeof TABLES)[number], FakeRow[]>,
    foreignKeys: {
      problem_kcs: { problem_id: "problems" },
      topic_kcs: { topic_id: "topics" },
      questions: { session_id: "study_sessions" },
      attempts: { question_id: "questions", session_id: "study_sessions" },
    },
    defaults: {
      problems: () => ({
        created_at: now(),
        task_type: null,
        original_exercise_id: null,
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
      // As the real function: a running run drops the call.
      queue_problem_run: (args, tables) => {
        if (tables.problem_runs.some((run) => run.status === "running")) {
          return false;
        }
        tables.problem_runs = [
          {
            course_id: args.p_course_id,
            owner: STUDENT,
            status: "running",
            stock: args.p_topic_id ? "topic" : "review",
            topic_id: args.p_topic_id ?? null,
          },
        ];
        return true;
      },
    },
  });
}

let db = createDb();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));
const startWorkflow = vi.fn(async () => ({}));
vi.mock("workflow/api", () => ({ start: startWorkflow }));

const { generateProblems } = await import("./generate-problems");
const { queueProblemGeneration } =
  await import("@/features/study/server/problem-generation");

beforeEach(() => {
  db = createDb();
  startWorkflow.mockClear();
});

/** A draft whose numbers all come from its program; fits either schema. */
const DRAFT = {
  change: "new_values",
  taskType: "compute thrust",
  statement:
    "A turbojet takes in {{mass_flow}} at {{v_0}}, which leaves at {{v_e}}. Compute the thrust.",
  solution: "$F = \\dot m (v_e - v_0)$, so the thrust is {{thrust_kN}}.",
  program:
    "mass_flow = 50 kg/s\nv_0 = 250 m/s\nv_e = 600 m/s\nthrust_kN = to(mass_flow * (v_e - v_0), kN)",
  finalAnswers: [{ variable: "thrust_kN", unit: "kN" }],
};

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

/** A `generate` model answering in turn, the last answer from then on. */
function useGenerateModel(...answers: Array<object | Error>) {
  let call = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      const answer = answers[Math.min(call++, answers.length - 1)]!;
      if (answer instanceof Error) throw answer;
      return {
        content: [{ type: "text", text: JSON.stringify(answer) }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
  useMockModels({ generate: model });
  return model;
}

/**
 * A Course whose Topic has `kcIds` and whose one Exercise, testing k1, the
 * Student was asked in an ended session three days ago, with an attempt on
 * each of `taught`.
 */
function seedCourse(kcIds: string[], taught: string[] = []) {
  const t = db.tables;
  const owned = { owner: STUDENT, course_id: COURSE };
  t.knowledge_map_builds.push({
    ...owned,
    finished_at: "2026-10-01T00:00:00Z",
  });
  t.materials.push({
    id: "m1",
    ...owned,
    name: "Sheet 7",
    is_exam: false,
    created_at: "2026-10-01T00:00:00Z",
  });
  t.chunks.push({
    id: QUESTION_CHUNK,
    ...owned,
    material_id: "m1",
    position: 0,
    page_from: 1,
    page_to: 1,
    markdown: "Ex. 7.2a: compute the thrust.",
  });
  t.big_ideas.push({
    id: "b1",
    ...owned,
    name: "Thrust",
    description: "Thrust.",
    position: 0,
  });
  const kcs = [...new Set([...kcIds, ...taught])];
  kcs.forEach((id, position) => {
    t.kcs.push({
      id,
      ...owned,
      big_idea_id: "b1",
      name: `KC ${id}`,
      description: `${id}.`,
      type: "concept",
      bloom: "apply",
      origin: "content",
      position,
    });
    t.kc_sources.push({ ...owned, kc_id: id, chunk_id: QUESTION_CHUNK });
  });
  t.topics.push({
    id: TOPIC,
    ...owned,
    big_idea_id: "b1",
    name: "Thrust",
    central_question: "How much?",
    why_it_matters: "Planes.",
    position: 0,
  });
  kcIds.forEach((kc_id, position) =>
    t.topic_kcs.push({ topic_id: TOPIC, kc_id, owner: STUDENT, position }),
  );
  t.exercises.push({
    id: "x1",
    ...owned,
    name: "Ex. 7.2a",
    question_chunk_id: QUESTION_CHUNK,
    task_type: "compute thrust",
    solution_status: "given",
    solution: null,
    difficulty: 2,
    position: 0,
    final_answers: [{ label: "Thrust", value: 17.5, unit: "kN" }],
  });
  t.exercise_kcs.push({ ...owned, exercise_id: "x1", kc_id: "k1" });
  const at = new Date(Date.now() - 3 * DAY_MS).toISOString();
  t.study_sessions.push({ id: "s0", ...owned, chat_id: null, ended_at: at });
  t.questions.push({
    id: "q0",
    owner: STUDENT,
    session_id: "s0",
    exercise_id: "x1",
    problem_id: null,
    kind: "question",
    confidence: null,
    asked_at: at,
    answered_at: at,
  });
  for (const kc_id of taught) {
    t.attempts.push({
      id: `a-${kc_id}`,
      owner: STUDENT,
      session_id: "s0",
      question_id: "q0",
      kc_id,
      kind: "learn",
      result: "full",
      help: "none",
      created_at: at,
    });
  }
}

function seedRun(stock: "topic" | "review") {
  db.tables.problem_runs.push({
    course_id: COURSE,
    owner: STUDENT,
    status: "running",
    stock,
    topic_id: stock === "topic" ? TOPIC : null,
  });
}

/** A stored Problem testing `kcs`, as a run or the Student left it. */
function seedProblem(id: string, kcs: string[], row: FakeRow) {
  db.tables.problems.push({
    id,
    owner: STUDENT,
    course_id: COURSE,
    source: "new",
    difficulty: 1,
    flag: null,
    original_exercise_id: null,
    created_at: "2026-10-20T00:00:00Z",
    ...row,
  });
  for (const kc_id of kcs)
    db.tables.problem_kcs.push({
      problem_id: id,
      kc_id,
      owner: STUDENT,
      course_id: COURSE,
    });
}

const kcsOf = (problemId: unknown) =>
  db.tables.problem_kcs
    .filter((row) => row.problem_id === problemId)
    .map((row) => row.kc_id);
const queuedBy = () =>
  db.tables.problems
    .filter((row) => String(row.created_at) >= "2026-10-25")
    .map((row) => ({
      source: row.source,
      kcs: kcsOf(row.id),
      status: row.status,
    }));

describe("Topic stock", () => {
  test("each KC below 2 unseen Problems gets up to 2, a variant of the seen Exercise first, at most 4 per Topic", async () => {
    seedCourse(["k1", "k2", "k3"]);
    seedRun("topic");
    useGenerateModel(DRAFT);

    await generateProblems(COURSE);

    expect(queuedBy()).toEqual([
      { source: "variant", kcs: ["k1"], status: "ready" },
      { source: "new", kcs: ["k1"], status: "ready" },
      { source: "new", kcs: ["k2"], status: "ready" },
      { source: "new", kcs: ["k2"], status: "ready" },
    ]);
    const variant = db.tables.problems.find((row) => row.source === "variant")!;
    expect(variant).toMatchObject({
      topic_id: TOPIC,
      original_exercise_id: "x1",
      task_type: "compute thrust",
      difficulty: 2,
      solution: "$F = \\dot m (v_e - v_0)$, so the thrust is 17.5 kN.",
      final_answers: [{ label: "thrust_kN", value: 17.5, unit: "kN" }],
    });
    expect(variant.statement).not.toContain("{{");
    expect(variant.statement).toContain("250");
    expect(db.tables.ai_usage).toMatchObject(
      Array(4).fill({ owner: STUDENT, task: "generate" }),
    );
    expect(db.tables.problem_runs[0]?.status).toBe("done");
  });

  test("the reserved exam's Exercises are no stock and no variant source", async () => {
    seedCourse(["k1"]);
    db.tables.materials[0]!.is_exam = true;
    db.tables.briefs.push({
      course_id: COURSE,
      owner: STUDENT,
      reserved_exam_material_id: "m1",
    });
    seedRun("topic");
    useGenerateModel(DRAFT);

    await generateProblems(COURSE);

    expect(queuedBy()).toEqual([
      { source: "new", kcs: ["k1"], status: "ready" },
      { source: "new", kcs: ["k1"], status: "ready" },
    ]);
  });

  test("once a submitted mock used the reservation, its exam is an ordinary Material", async () => {
    seedCourse(["k1"]);
    db.tables.materials[0]!.is_exam = true;
    db.tables.briefs.push({
      course_id: COURSE,
      owner: STUDENT,
      reserved_exam_material_id: "m1",
    });
    db.tables.mock_exams.push({
      id: "mock1",
      course_id: COURSE,
      status: "submitted",
      reserved_material_id: "m1",
    });
    seedRun("topic");
    useGenerateModel(DRAFT);

    await generateProblems(COURSE);

    expect(queuedBy()[0]).toEqual({
      source: "variant",
      kcs: ["k1"],
      status: "ready",
    });
  });

  test("ready unflagged and queued Problems count as stock; failed, flagged and asked ones don't", async () => {
    seedCourse(["k1", "k2", "k3"]);
    seedRun("topic");
    seedProblem("p-ready", ["k1"], {
      status: "ready",
      statement: "S",
      solution: "S",
    });
    seedProblem("p-queued", ["k1"], { status: "queued" });
    seedProblem("p-failed", ["k2"], { status: "failed", failure: "No." });
    seedProblem("p-flagged", ["k2"], {
      status: "ready",
      statement: "S",
      solution: "S",
      flag: "wrong",
    });
    seedProblem("p-asked", ["k3"], {
      status: "ready",
      statement: "S",
      solution: "S",
    });
    db.tables.questions.push({
      id: "q1",
      owner: STUDENT,
      session_id: "s0",
      exercise_id: null,
      problem_id: "p-asked",
      kind: "question",
      asked_at: "2026-10-21T00:00:00Z",
    });
    useGenerateModel(DRAFT);

    await generateProblems(COURSE);

    expect(queuedBy()).toEqual([
      { source: "new", kcs: ["k2"], status: "ready" },
      { source: "new", kcs: ["k2"], status: "ready" },
      { source: "new", kcs: ["k3"], status: "ready" },
      { source: "new", kcs: ["k3"], status: "ready" },
    ]);
    // The queued one from before is written in the same run.
    expect(
      db.tables.problems.find((row) => row.id === "p-queued")?.status,
    ).toBe("ready");
  });
});

test("review stock: each KC due within 3 days without an unseen Problem gets one, at most 6", async () => {
  const taught = ["k1", "k2", "k3", "k4", "k5", "k6", "k7"];
  seedCourse(["k1"], taught);
  seedProblem("p-ready", ["k2"], {
    status: "ready",
    statement: "S",
    solution: "S",
  });
  seedRun("review");
  useGenerateModel(DRAFT);

  await generateProblems(COURSE);

  expect(queuedBy()).toEqual([
    { source: "variant", kcs: ["k1"], status: "ready" },
    ...["k3", "k4", "k5", "k6", "k7"].map((kc) => ({
      source: "new",
      kcs: [kc],
      status: "ready",
    })),
  ]);
  expect(
    db.tables.problems
      .filter((row) => row.status === "ready" && row.id !== "p-ready")
      .every((row) => row.topic_id === null),
  ).toBe(true);
});

describe("one Problem's run", () => {
  /** A Topic of one KC that has one ready Problem: one variant to write. */
  function seedOne() {
    seedCourse(["k1"]);
    seedProblem("p-ready", ["k1"], {
      status: "ready",
      statement: "S",
      solution: "S",
    });
    seedRun("topic");
  }
  const written = () =>
    db.tables.problems.find((row) => row.source === "variant")!;
  const unresolved = { ...DRAFT, solution: "The thrust is {{thrust}}." };

  test("a draft that fails goes back once with its error, and the fixed one is stored", async () => {
    seedOne();
    const model = useGenerateModel(unresolved, DRAFT);

    await generateProblems(COURSE);

    expect(model.doGenerateCalls).toHaveLength(2);
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain(
      "This draft failed: Solution: Unresolved placeholders: {{thrust}}",
    );
    expect(written()).toMatchObject({ status: "ready", failure: null });
    expect(db.tables.ai_usage).toHaveLength(2);
  });

  test("a second failure fails it with the reason", async () => {
    seedOne();
    const model = useGenerateModel(unresolved, {
      ...DRAFT,
      program: "m = 2 kg\nthrust_kN = to(m * 1 m/s^2, kN)",
    });

    await generateProblems(COURSE);

    expect(model.doGenerateCalls).toHaveLength(2);
    expect(written()).toMatchObject({ status: "failed", statement: null });
    expect(written().failure).toMatch(/^Program: .*\bm\b/);
    expect(written().program).toMatch(/^m = 2 kg/);
  });

  test("a model error fails it without a retry", async () => {
    seedOne();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const model = useGenerateModel(new Error("Provider down"));

    await generateProblems(COURSE);

    expect(model.doGenerateCalls).toHaveLength(1);
    expect(written()).toMatchObject({
      status: "failed",
      failure: "The model call failed.",
    });
    expect(db.tables.problem_runs[0]?.status).toBe("done");
  });
});

test("a reached Daily limit leaves the rest queued, and the next run writes them", async () => {
  vi.stubEnv("AI_DAILY_LIMIT_USD", "0.0000001");
  seedCourse(["k1", "k2"]);
  seedRun("topic");
  const model = useGenerateModel(DRAFT);

  await generateProblems(COURSE);

  expect(model.doGenerateCalls).toHaveLength(1);
  expect(queuedBy().map(({ status }) => status)).toEqual([
    "ready",
    "queued",
    "queued",
    "queued",
  ]);
  expect(db.tables.problem_runs[0]?.status).toBe("done");

  vi.stubEnv("AI_DAILY_LIMIT_USD", "1");
  db.tables.problem_runs[0]!.status = "running";
  await generateProblems(COURSE);

  expect(queuedBy().map(({ status }) => status)).toEqual([
    "ready",
    "ready",
    "ready",
    "ready",
  ]);
});

test("a trigger while a run runs is dropped", async () => {
  const supabase = db as unknown as Supabase;
  await queueProblemGeneration(supabase, COURSE, TOPIC);
  await queueProblemGeneration(supabase, COURSE, null);

  expect(startWorkflow).toHaveBeenCalledTimes(1);
  expect(db.tables.problem_runs).toMatchObject([
    { stock: "topic", topic_id: TOPIC },
  ]);
});
