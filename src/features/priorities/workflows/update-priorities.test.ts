// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { mockTextModel, useMockModels } from "@/lib/ai/testing";
import { markAdminClient } from "@/lib/supabase/admin-brand";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";
import type { Supabase } from "@/lib/supabase/types";

vi.mock("server-only", () => ({}));

const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const STUDENT = "11111111-1111-1111-1111-111111111111";
const LECTURE = "cccccccc-0000-4000-8000-000000000001";
const EXAM = "cccccccc-0000-4000-8000-000000000002";
const SHEET = "cccccccc-0000-4000-8000-000000000003";

/**
 * The admin client as a `fakeSupabase`; `replace_kc_priorities` stands in
 * for the database function, which pgTAP tests.
 */
function createDb() {
  return fakeSupabase({
    tables: {
      priority_runs: [] as FakeRow[],
      kc_priorities: [] as FakeRow[],
      materials: [] as FakeRow[],
      chunks: [] as FakeRow[],
      briefs: [] as FakeRow[],
      brief_excluded_materials: [] as FakeRow[],
      big_ideas: [] as FakeRow[],
      kcs: [] as FakeRow[],
      kc_sources: [] as FakeRow[],
      prerequisite_links: [] as FakeRow[],
      semantic_links: [] as FakeRow[],
      exercises: [] as FakeRow[],
      exercise_kcs: [] as FakeRow[],
      findings: [] as FakeRow[],
      finding_sources: [] as FakeRow[],
      knowledge_map_builds: [] as FakeRow[],
      ai_usage: [] as FakeRow[],
    },
    defaults: { ai_usage: () => ({ created_at: new Date().toISOString() }) },
    functions: {
      replace_kc_priorities: (args, tables) => {
        const run = tables.priority_runs.find(
          (row) =>
            row.course_id === args.p_course_id && row.status === "running",
        );
        if (!run) return false;
        tables.kc_priorities = (
          args.p_priorities as Array<{
            kcId: string;
            priority: number;
            multiplier: number;
            reasons: string[];
          }>
        ).map((entry) => ({
          kc_id: entry.kcId,
          course_id: args.p_course_id,
          priority: entry.priority,
          multiplier: entry.multiplier,
          reasons: entry.reasons,
        }));
        run.status = "done";
        if (args.p_adjustments) {
          run.adjustments = args.p_adjustments;
          run.adjusted_at = run.computed_at;
        }
        return true;
      },
    },
  });
}

let db = createDb();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));

const { updatePriorities } = await import("./update-priorities");

beforeEach(() => {
  db = createDb();
});

/** A Course with a lecture, an exam and a skipped sheet, and three KCs. */
function seedCourse() {
  const t = db.tables;
  t.priority_runs.push({
    course_id: COURSE,
    owner: STUDENT,
    status: "running",
    computed_at: "2026-10-02T00:00:00Z",
    adjusted_at: null,
    adjustments: [],
  });
  t.knowledge_map_builds.push({
    course_id: COURSE,
    finished_at: "2026-10-01T00:00:00Z",
  });
  t.materials.push(
    { id: "m-lecture", course_id: COURSE, name: "Lecture 1", is_exam: false },
    { id: "m-exam", course_id: COURSE, name: "Exam 2024", is_exam: true },
    { id: "m-sheet", course_id: COURSE, name: "Sheet 9", is_exam: false },
  );
  t.chunks.push(
    { id: LECTURE, course_id: COURSE, material_id: "m-lecture", points: null },
    { id: EXAM, course_id: COURSE, material_id: "m-exam", points: 10 },
    { id: SHEET, course_id: COURSE, material_id: "m-sheet", points: null },
  );
  t.brief_excluded_materials.push({
    course_id: COURSE,
    material_id: "m-sheet",
  });
  t.big_ideas.push({
    id: "b1",
    course_id: COURSE,
    name: "Thrust",
    description: "Thrust.",
    position: 0,
  });
  const kc = (id: string, name: string, position: number) => ({
    id,
    course_id: COURSE,
    big_idea_id: "b1",
    name,
    description: `${name}.`,
    type: "concept",
    bloom: "apply",
    origin: "content",
    position,
  });
  t.kcs.push(
    kc("k1", "Thrust", 0),
    kc("k2", "Thrust equation", 1),
    kc("k3", "Ramjets", 2),
  );
  t.kc_sources.push(
    { course_id: COURSE, kc_id: "k1", chunk_id: LECTURE },
    { course_id: COURSE, kc_id: "k2", chunk_id: LECTURE },
    { course_id: COURSE, kc_id: "k3", chunk_id: SHEET },
  );
  t.prerequisite_links.push({
    id: 1,
    course_id: COURSE,
    from_kc: "k1",
    to_kc: "k2",
    extraction_confidence: 0.9,
  });
  t.exercises.push({
    id: "x1",
    course_id: COURSE,
    question_chunk_id: EXAM,
    name: "Ex. 1",
    task_type: "compute thrust",
    solution_status: "given",
    solution: null,
    difficulty: 2,
    position: 0,
  });
  t.exercise_kcs.push({ course_id: COURSE, exercise_id: "x1", kc_id: "k2" });
}

test("a run stores every KC's priority, multiplier and reasons, and is done", async () => {
  seedCourse();
  await updatePriorities(COURSE);

  const stored = Object.fromEntries(
    db.tables.kc_priorities.map((row) => [row.kc_id, row]),
  );
  // k2: exam 1, Exercises 1, dependents 0; k1: dependents 1.
  expect(stored.k2).toMatchObject({ priority: 0.75, multiplier: 1 });
  expect(stored.k1).toMatchObject({
    priority: 0.25,
    multiplier: 1,
    reasons: ["1 KC builds on it"],
  });
  expect(stored.k3).toMatchObject({
    priority: 0,
    multiplier: 0,
    reasons: ["Excluded: you skip Sheet 9"],
  });
  expect(db.tables.priority_runs[0]?.status).toBe("done");
});

test("a failing run is failed with a reason and keeps the previous priorities", async () => {
  seedCourse();
  db.tables.kc_priorities.push({ kc_id: "k1", course_id: COURSE, priority: 1 });
  db.tables.kcs[0] = { ...db.tables.kcs[0], type: "not a type" };
  vi.spyOn(console, "error").mockImplementation(() => {});

  await updatePriorities(COURSE);

  expect(db.tables.priority_runs[0]).toMatchObject({
    status: "failed",
    failure_reason: "The priorities could not be computed.",
  });
  expect(db.tables.kc_priorities).toHaveLength(1);
});

test("no running run computes nothing", async () => {
  seedCourse();
  db.tables.priority_runs[0] = {
    ...db.tables.priority_runs[0],
    status: "done",
  };
  await updatePriorities(COURSE);
  expect(db.tables.kc_priorities).toEqual([]);
});

test("notes adjust the multipliers once, and a rerun with unchanged notes reuses them", async () => {
  seedCourse();
  db.tables.briefs.push({
    course_id: COURSE,
    notes: "The thrust equation is stressed. Thrust matters less.",
    notes_updated_at: "2026-10-01T12:00:00Z",
  });
  const model = mockTextModel(
    JSON.stringify({
      entries: [
        { id: "B1", multiplier: 0.5, reason: "Matters less" },
        { id: "K2", multiplier: 2, reason: "The lecturer stressed it" },
      ],
    }),
  );
  useMockModels({ priority: model });

  await updatePriorities(COURSE);
  const run = db.tables.priority_runs[0] as FakeRow;
  Object.assign(run, {
    status: "running",
    computed_at: "2026-10-03T00:00:00Z",
  });
  await updatePriorities(COURSE);

  expect(model.doGenerateCalls).toHaveLength(1);
  expect(db.tables.ai_usage).toHaveLength(1);
  const stored = Object.fromEntries(
    db.tables.kc_priorities.map((row) => [row.kc_id, row]),
  );
  expect(stored.k2).toMatchObject({
    priority: 1.5,
    multiplier: 2,
    reasons: [
      "10 points in old exams",
      "Tested by 1 Exercise",
      "The lecturer stressed it",
    ],
  });
  expect(stored.k1).toMatchObject({ priority: 0.125, multiplier: 0.5 });
  expect(stored.k3).toMatchObject({ multiplier: 0 });
  expect(run).toMatchObject({
    status: "done",
    adjusted_at: "2026-10-02T00:00:00Z",
  });
});
