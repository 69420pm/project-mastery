import "server-only";
import { randomUUID } from "node:crypto";
import { getExamFacts, getReservedExam } from "@/features/brief/server";
import {
  loadChunkSources,
  loadMaterialChunkIds,
} from "@/features/ingestion/server";
import {
  loadStoredMap,
  loadStoredTopics,
} from "@/features/knowledge-map/server";
import { loadKcPriorities } from "@/features/priorities/server";
import { itemMinutes } from "@/features/study/domain/exam-profile";
import {
  fillMock,
  mockTotals,
  planGaps,
  planMock,
  predictedSuccess,
  type MockCandidate,
} from "@/features/study/domain/mock-plan";
import { kcState } from "@/features/study/domain/replay";
import {
  loadAskedProblems,
  loadSchedules,
} from "@/features/study/server/attempts";
import { loadPlan } from "@/features/study/server/plan";
import { loadReadyProblems } from "@/features/study/server/problems";
import { queueProblems } from "@/features/study/workflows/stock-steps";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The steps of `assembleMock` (#185) besides writing the generated
 * Problems. Each runs on the admin client, since no Student is signed in,
 * and so scopes every query to the mock's Course; each writes the mock only
 * while it is still assembling.
 */

/** An item of the planned mock, in position order. */
export type PlannedItem = {
  exerciseId: string | null;
  /** A ready Problem, or the queued one a gap generates. */
  problemId: string | null;
  /** Whether it waits for its Problem to be generated. */
  gap: boolean;
  topicId: string | null;
  /** The statement; null for a gap until its Problem is written. */
  prompt: string | null;
  points: number;
  predictedSuccess: number;
};

export type MockPlan = {
  items: PlannedItem[];
  /** Why the mock fails when it ends up without items. */
  emptyReason: string;
};

const NO_ITEMS = "No problems could be found or generated for your Topics.";

/**
 * Plans the assembling mock: the final mock when the Phase is the final
 * week and a reservation is active, else the blueprint filled from the
 * Course's unseen Problems, with a Problem queued for each of up to 6 empty
 * slots. Records how many it generates. Null when the mock is no longer
 * assembling.
 */
export async function planMockExam(
  mockId: string,
  now: Date = new Date(),
): Promise<MockPlan | null> {
  "use step";
  const supabase = createAdminClient();
  const mock = await loadAssembling(supabase, mockId);
  if (!mock) return null;
  const { owner, course_id: courseId } = mock;

  const [map, topics, priorities, exam, asked, ready, reservedId] =
    await Promise.all([
      loadStoredMap(supabase, courseId),
      loadStoredTopics(supabase, courseId),
      loadKcPriorities(supabase, courseId),
      getExamFacts(supabase, courseId),
      loadAskedProblems(supabase, courseId),
      loadReadyProblems(supabase, courseId),
      getReservedExam(supabase, courseId),
    ]);
  const reserved = new Set(
    reservedId === null ? [] : await loadMaterialChunkIds(supabase, reservedId),
  );
  const schedules = await loadSchedules(
    supabase,
    courseId,
    { examDate: exam.examDate, goal: exam.goal, priorities },
    now,
  );
  const plan = await loadPlan(
    supabase,
    courseId,
    {
      prerequisites: map.prerequisites,
      priorities,
      exam,
      schedules,
      dueCount: 0,
      topics,
    },
    now,
  );
  const recall = new Map(
    map.kcs.map((kc) => [
      kc.id,
      kcState(schedules.get(kc.id), now).retrievability,
    ]),
  );
  const topicKcs = new Map(topics.map((topic) => [topic.id, topic.kcs]));
  const topicOf = (kcs: string[]) =>
    topics.find((topic) => topic.kcs.some((kc) => kcs.includes(kc)))?.id ??
    null;
  const item = (
    fields: Pick<PlannedItem, "exerciseId" | "problemId" | "prompt"> & {
      kcs: string[];
      difficulty: number;
      topicId?: string | null;
    },
  ): PlannedItem => ({
    exerciseId: fields.exerciseId,
    problemId: fields.problemId,
    gap: false,
    topicId:
      fields.topicId === undefined ? topicOf(fields.kcs) : fields.topicId,
    prompt: fields.prompt,
    points: itemMinutes(fields.difficulty),
    predictedSuccess: predictedSuccess(fields.kcs, recall),
  });
  const exercises = map.exercises.map((exercise) => ({
    ...exercise,
    reserved: reserved.has(exercise.questionChunk),
    seen: asked.has(exercise.id),
  }));

  if (plan.phase === "final_week" && reservedId !== null) {
    // The final mock is the reserved exam's Exercises, in order.
    const final = exercises.filter((e) => e.reserved);
    const chunks = await questionChunks(supabase, final);
    await setFinal(supabase, mockId, reservedId);
    return {
      items: final.flatMap((exercise) => {
        const chunk = chunks.get(exercise.questionChunk);
        return chunk
          ? [
              item({
                exerciseId: exercise.id,
                problemId: null,
                prompt: chunk.markdown,
                kcs: exercise.kcs,
                difficulty: exercise.difficulty,
              }),
            ]
          : [];
      }),
      emptyReason: "The reserved exam has no Exercises to use.",
    };
  }

  const slots = planMock(
    plan.topics
      .filter((topic) => topic.status === "in_plan")
      .map(({ id, priority }) => ({ id, priority })),
  );
  if (slots.length === 0) {
    return { items: [], emptyReason: "Your study plan has no Topics yet." };
  }
  const usable = exercises.filter((e) => !e.seen && !e.reserved);
  const chunks = await questionChunks(supabase, usable);
  const candidates: Array<MockCandidate & { prompt: string }> = [
    ...usable.flatMap((exercise) => {
      const chunk = chunks.get(exercise.questionChunk);
      return chunk
        ? [
            {
              id: exercise.id,
              kind: "exercise" as const,
              source: chunk.isExam
                ? ("old_exam" as const)
                : ("exercise" as const),
              kcs: exercise.kcs,
              difficulty: exercise.difficulty,
              seen: false,
              prompt: chunk.markdown,
            },
          ]
        : [];
    }),
    ...ready.map((problem) => ({
      id: problem.id,
      kind: "problem" as const,
      source: problem.source,
      kcs: problem.kcs,
      difficulty: problem.difficulty,
      seen: asked.has(problem.id),
      prompt: problem.statement,
    })),
  ];
  const filled = fillMock(slots, topicKcs, candidates);
  const gaps = planGaps(
    slots.map((slot, index) => (filled[index] ? null : slot)),
    topicKcs,
    exercises.filter((e) => !e.reserved),
    priorities,
  );
  const queued = gaps.map(({ slot, problem }) => {
    const original =
      problem.source === "variant"
        ? exercises.find((e) => e.id === problem.exerciseId)
        : undefined;
    return {
      slot,
      row: {
        id: randomUUID(),
        owner,
        course_id: courseId,
        status: "queued",
        source: problem.source,
        topic_id: slots[slot]!.topicId,
        original_exercise_id: original?.id ?? null,
        difficulty: problem.difficulty,
      },
      kcs: problem.kcs,
    };
  });
  await queueProblems(supabase, owner, courseId, queued);
  await setGapsTotal(supabase, mockId, queued.length);

  const items = slots.flatMap((slot, index): PlannedItem[] => {
    const candidate = filled[index];
    if (candidate) {
      return [
        item({
          exerciseId: candidate.kind === "exercise" ? candidate.id : null,
          problemId: candidate.kind === "problem" ? candidate.id : null,
          prompt: candidate.prompt,
          kcs: candidate.kcs,
          difficulty: candidate.difficulty,
          topicId: slot.topicId,
        }),
      ];
    }
    const gap = queued.find((q) => q.slot === index);
    if (!gap) return [];
    return [
      {
        ...item({
          exerciseId: null,
          problemId: gap.row.id,
          prompt: null,
          kcs: gap.kcs,
          difficulty: gap.row.difficulty,
          topicId: slot.topicId,
        }),
        gap: true,
      },
    ];
  });
  return { items, emptyReason: NO_ITEMS };
}

async function loadAssembling(supabase: Supabase, mockId: string) {
  const { data, error } = await supabase
    .from("mock_exams")
    .select("owner, course_id")
    .eq("id", mockId)
    .eq("status", "assembling")
    .maybeSingle();
  if (error) failed("Loading the assembling mock exam", error);
  return data;
}

/** The question chunks of the Exercises, by id. */
async function questionChunks(
  supabase: Supabase,
  exercises: Array<{ questionChunk: string }>,
) {
  const chunks = await loadChunkSources(
    supabase,
    exercises.map((exercise) => exercise.questionChunk),
  );
  return new Map(chunks.map((chunk) => [chunk.id, chunk]));
}

async function setFinal(
  supabase: Supabase,
  mockId: string,
  materialId: string,
): Promise<void> {
  const { error } = await supabase
    .from("mock_exams")
    .update({ reserved_material_id: materialId })
    .eq("id", mockId)
    .eq("status", "assembling");
  if (error) failed("Marking the final mock exam", error);
}

async function setGapsTotal(
  supabase: Supabase,
  mockId: string,
  total: number,
): Promise<void> {
  const { error } = await supabase
    .from("mock_exams")
    .update({ gaps_total: total })
    .eq("id", mockId)
    .eq("status", "assembling");
  if (error) failed("Recording the mock exam's gaps", error);
}

/** Records how many of the mock's gaps assembly has finished. */
export async function setGapsDone(mockId: string, done: number): Promise<void> {
  "use step";
  const { error } = await createAdminClient()
    .from("mock_exams")
    .update({ gaps_done: done })
    .eq("id", mockId)
    .eq("status", "assembling");
  if (error) failed("Recording the mock exam's progress", error);
}

/**
 * Stores the planned items, keeping a gap only when its Problem in
 * `generated` is ready, and makes the mock ready with its duration and
 * predicted score; fails it with the plan's reason when no item is left.
 */
export async function finishMockExam(
  mockId: string,
  plan: MockPlan,
  generated: string[],
): Promise<void> {
  "use step";
  const supabase = createAdminClient();
  const mock = await loadAssembling(supabase, mockId);
  if (!mock) return;
  const written = await loadStatements(
    supabase,
    plan.items.flatMap((item) =>
      item.gap && item.problemId && generated.includes(item.problemId)
        ? [item.problemId]
        : [],
    ),
  );
  const items = plan.items.flatMap((item) => {
    if (!item.gap) return item.prompt === null ? [] : [item];
    const prompt = item.problemId ? written.get(item.problemId) : undefined;
    return prompt === undefined ? [] : [{ ...item, prompt }];
  });
  if (items.length === 0) {
    await fail(supabase, mockId, plan.emptyReason);
    return;
  }

  const rows = items.map((item, position) => ({
    id: randomUUID(),
    mock_id: mockId,
    owner: mock.owner,
    position,
    exercise_id: item.exerciseId,
    problem_id: item.problemId,
    topic_id: item.topicId,
    prompt: item.prompt ?? "",
    points: item.points,
    predicted_success: item.predictedSuccess,
  }));
  const inserted = await supabase.from("mock_items").insert(rows);
  if (inserted.error) failed("Storing the mock exam's items", inserted.error);
  const { durationMinutes, predictedScore } = mockTotals(items);
  const { data, error } = await supabase
    .from("mock_exams")
    .update({
      status: "ready",
      duration_minutes: durationMinutes,
      predicted_score: predictedScore,
    })
    .eq("id", mockId)
    .eq("status", "assembling")
    .select("id");
  if (error) failed("Making the mock exam ready", error);
  if (data.length === 0) {
    // It failed meanwhile, as one still assembling after an hour does.
    await supabase.from("mock_items").delete().eq("mock_id", mockId);
  }
}

/** The statements of the ready Problems among `ids`. */
async function loadStatements(
  supabase: Supabase,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("problems")
    .select("id, statement")
    .in("id", ids)
    .eq("status", "ready");
  if (error) failed("Loading the generated Problems", error);
  return new Map(
    data.flatMap(({ id, statement }) =>
      statement === null ? [] : [[id, statement] as const],
    ),
  );
}

async function fail(
  supabase: Supabase,
  mockId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase
    .from("mock_exams")
    .update({ status: "failed", failure: reason })
    .eq("id", mockId)
    .eq("status", "assembling");
  if (error) failed("Failing the mock exam", error);
}

/** Fails the assembling mock with the reason. */
export async function failMockExam(
  mockId: string,
  reason: string,
): Promise<void> {
  "use step";
  await fail(createAdminClient(), mockId, reason);
}
