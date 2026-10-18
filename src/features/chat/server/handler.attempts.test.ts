// @vitest-environment node
// The chat handler's recordAttempt tool: what it stores and what the model
// learns of the review ladder, and the KC states read from it. Shared setup
// and helpers: handler-testing.ts.
import { randomUUID } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { mockToolModel, useMockModels } from "@/lib/ai/testing";
import {
  COURSE,
  MAP,
  STUDENT,
  db,
  seedMap,
  send,
  userMessage,
} from "./handler-testing";

vi.mock("server-only", () => ({}));

const DAY_MS = 24 * 60 * 60 * 1000;
const day = (offset: number) =>
  new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);

/** The KC states the map page reads, loaded after handler-testing's mocks. */
const kcStates = async () =>
  (await import("@/features/study/server")).getKcStates(COURSE);

/** A model that calls recordAttempt with `input`, then says "Well done." */
const recording = (input: unknown) =>
  mockToolModel([[{ toolName: "recordAttempt", input }]], "Well done.");

/** Sends an answer, and returns the reply and the tool result the model saw. */
async function answer(model: ReturnType<typeof recording>) {
  const reply = await send({
    chatId: randomUUID(),
    courseId: COURSE,
    message: userMessage("F = 2 kN"),
  });
  return { reply, result: JSON.stringify(model.doStreamCalls.at(-1)!.prompt) };
}

describe("recordAttempt", () => {
  test("stores one row per KC and tells the model each KC's level and next review", async () => {
    seedMap();

    const model = recording({
      help: "some",
      kcs: [
        { kcId: MAP.thrust, correct: true },
        { kcId: MAP.prior, correct: false },
      ],
    });
    useMockModels({ chat: model });

    const { reply, result } = await answer(model);

    expect(reply.text).toBe("Well done.");
    expect(db.tables.attempts).toEqual([
      expect.objectContaining({
        owner: STUDENT,
        course_id: COURSE,
        kc_id: MAP.thrust,
        exercise_id: null,
        correct: true,
        help: "some",
      }),
      expect.objectContaining({ kc_id: MAP.prior, correct: false }),
    ]);
    // First attempts: taught, due tomorrow.
    expect(result).toContain(`"level":1,"nextReview":"${day(1)}"`);
    expect(await kcStates()).toEqual({
      [MAP.thrust]: { state: "learning", level: 1, nextReview: day(1) },
      [MAP.prior]: { state: "learning", level: 1, nextReview: day(1) },
    });
  });

  test("climbs a due KC a level on a correct answer", async () => {
    seedMap();
    db.tables.attempts.push({
      id: randomUUID(),
      owner: STUDENT,
      course_id: COURSE,
      kc_id: MAP.thrust,
      exercise_id: null,
      correct: true,
      help: "none",
      created_at: new Date(Date.now() - 3 * DAY_MS).toISOString(),
    });
    expect((await kcStates())[MAP.thrust]?.state).toBe("due");
    const model = recording({
      help: "none",
      kcs: [{ kcId: MAP.thrust, correct: true }],
    });
    useMockModels({ chat: model });

    const { result } = await answer(model);

    expect(result).toContain(`"level":2,"nextReview":"${day(3)}"`);
    expect((await kcStates())[MAP.thrust]).toEqual({
      state: "mastered",
      level: 2,
      nextReview: day(3),
    });
  });

  test("refuses ids of no KC or Exercise of the Course, storing nothing", async () => {
    seedMap();

    const unknownKc = recording({
      help: "none",
      kcs: [{ kcId: "made-up", correct: true }],
    });
    useMockModels({ chat: unknownKc });
    const first = await answer(unknownKc);
    const unknownExercise = recording({
      exerciseId: "ex-made-up",
      help: "none",
      kcs: [{ kcId: MAP.thrust, correct: true }],
    });
    useMockModels({ chat: unknownExercise });
    const second = await answer(unknownExercise);

    expect(first.result).toContain(
      "These are no KC ids of this Course: made-up.",
    );
    expect(second.result).toContain(
      "ex-made-up is no Exercise id of this Course",
    );
    expect(db.tables.attempts).toEqual([]);
  });

  test("refuses a KC listed twice, storing nothing", async () => {
    seedMap();
    const model = recording({
      help: "none",
      kcs: [
        { kcId: MAP.thrust, correct: true },
        { kcId: MAP.thrust, correct: false },
      ],
    });
    useMockModels({ chat: model });

    const { result } = await answer(model);

    expect(result).toContain("List each KC once.");
    expect(db.tables.attempts).toEqual([]);
  });

  test("stores the Exercise's id when the problem was one", async () => {
    seedMap();
    const owned = { owner: STUDENT, course_id: COURSE };
    db.tables.exercises.push({
      ...owned,
      id: "ex-1",
      question_chunk_id: MAP.chunks[0],
      name: "Ex. 1",
      task_type: "compute thrust",
      solution_status: "given",
      solution: null,
      difficulty: 2,
      position: 0,
    });
    db.tables.exercise_kcs.push({
      ...owned,
      exercise_id: "ex-1",
      kc_id: MAP.thrust,
    });
    const model = recording({
      exerciseId: "ex-1",
      help: "none",
      kcs: [{ kcId: MAP.thrust, correct: true }],
    });
    useMockModels({ chat: model });

    await answer(model);

    expect(db.tables.attempts).toEqual([
      expect.objectContaining({ kc_id: MAP.thrust, exercise_id: "ex-1" }),
    ]);
  });
});
