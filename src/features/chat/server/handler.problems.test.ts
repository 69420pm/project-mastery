// @vitest-environment node
// The chat handler's findProblems and ask tools over a Course's Exercises.
// Shared setup and helpers: handler-testing.ts.
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

const firstMessage = () => ({
  chatId: randomUUID(),
  courseId: COURSE,
  message: userMessage("Let's start studying."),
});

const promptOf = (
  model: ReturnType<typeof mockToolModel>,
  call: number,
): string => JSON.stringify(model.doStreamCalls[call]!.prompt);

const EXAM = "aaaaaaaa-a000-4000-8000-000000000002";
const chunkOf = (n: number) => `aaaaaaaa-c400-4000-8000-0000000001${n}0`;

/** An exam Exercise with a paired solution, and a lecture one with a generated one. */
function seedExercises() {
  seedMap();
  const owned = { owner: STUDENT, course_id: COURSE };
  db.tables.materials.push({
    ...owned,
    id: EXAM,
    name: "Exam 2024",
    is_exam: true,
    created_at: "2025-12-02T00:00:00.000Z",
  });
  const chunk = (n: number, material: string, markdown: string) =>
    db.tables.chunks.push({
      ...owned,
      id: chunkOf(n),
      material_id: material,
      position: n,
      page_from: n,
      page_to: n,
      markdown,
    });
  chunk(1, EXAM, "Compute the thrust of the engine.");
  chunk(2, EXAM, "Solution: 42 kN.");
  chunk(3, MAP.material, "Why does thrust grow with exhaust speed?");
  const exercise = (n: number, status: string, solution: string | null) => {
    db.tables.exercises.push({
      ...owned,
      id: `ex-${n}`,
      question_chunk_id: chunkOf(n),
      name: `Ex. ${n}`,
      task_type: "compute thrust",
      solution_status: status,
      solution,
      difficulty: 2,
      position: n,
    });
    db.tables.exercise_kcs.push({
      ...owned,
      exercise_id: `ex-${n}`,
      kc_id: MAP.thrust,
    });
  };
  exercise(1, "disputed", null);
  exercise(3, "generated", "Generated: thrust is proportional to $v_e$.");
  db.tables.exercise_solutions.push({
    ...owned,
    exercise_chunk_id: chunkOf(1),
    solution_chunk_id: chunkOf(2),
    status: "paired",
  });
  db.tables.exercise_solutions.push({
    ...owned,
    exercise_chunk_id: chunkOf(3),
    solution_chunk_id: null,
    status: "no_solution",
  });
}

/** A question on an Exercise in an earlier session, answered with `help`. */
function answered(exerciseId: string, help: "none" | "some", askedAt: string) {
  const sessionId = randomUUID();
  const questionId = randomUUID();
  db.tables.study_sessions.push({
    id: sessionId,
    owner: STUDENT,
    course_id: COURSE,
    chat_id: null,
    ended_at: askedAt,
  });
  db.tables.questions.push({
    id: questionId,
    owner: STUDENT,
    session_id: sessionId,
    exercise_id: exerciseId,
    asked_at: askedAt,
  });
  db.tables.attempts.push({
    id: randomUUID(),
    owner: STUDENT,
    question_id: questionId,
    session_id: sessionId,
    kc_id: MAP.thrust,
    kind: "learn",
    result: "full",
    help,
    check: null,
    created_at: askedAt,
  });
}

/** A further lecture Exercise on the thrust KC. */
function addExercise(n: number, taskType: string, difficulty: number) {
  const owned = { owner: STUDENT, course_id: COURSE };
  db.tables.exercises.push({
    ...owned,
    id: `ex-${n}`,
    question_chunk_id: chunkOf(3),
    name: `Ex. ${n}`,
    task_type: taskType,
    solution_status: "generated",
    solution: "Generated.",
    difficulty,
    position: n,
  });
  db.tables.exercise_kcs.push({
    ...owned,
    exercise_id: `ex-${n}`,
    kc_id: MAP.thrust,
  });
}

const finderModel = (kcIds: string[] = [MAP.thrust], text = "Here.") =>
  mockToolModel([[{ toolName: "findProblems", input: { kcIds } }]], text);

/** The names of the Problems `findProblems` returned, in order. */
function foundOrder(model: ReturnType<typeof finderModel>) {
  const result = promptOf(model, 1);
  return ["Ex. 3", "Ex. 4", "Ex. 5"]
    .filter((name) => result.includes(name))
    .toSorted((a, b) => result.indexOf(a) - result.indexOf(b));
}

describe("findProblems ranking", () => {
  test("steps up one above the last unassisted success, and ignores help", async () => {
    seedExercises();
    addExercise(4, "compute thrust", 3);
    const now = Date.now();
    answered("ex-1", "none", new Date(now - 2000).toISOString());
    const first = finderModel();
    useMockModels({ chat: first });
    await send(firstMessage());
    expect(foundOrder(first)).toEqual(["Ex. 4", "Ex. 3"]);

    db.tables.attempts.length = 0;
    db.tables.questions.length = 0;
    answered("ex-1", "some", new Date(now - 2000).toISOString());
    const second = finderModel();
    useMockModels({ chat: second });
    await send(firstMessage());
    expect(foundOrder(second)).toEqual(["Ex. 3", "Ex. 4"]);
  });

  test("prefers a task type other than the last Problem's", async () => {
    seedExercises();
    addExercise(5, "explain", 2);
    answered("ex-1", "some", new Date().toISOString());
    const model = finderModel();
    useMockModels({ chat: model });
    await send(firstMessage());
    expect(foundOrder(model).slice(0, 2)).toEqual(["Ex. 5", "Ex. 3"]);
  });

  test("labels each Problem with its source", async () => {
    const model = finderModel();
    useMockModels({ chat: model });
    seedExercises();
    await send(firstMessage());
    const result = promptOf(model, 1);
    expect(result).toContain('"source":"old_exam"');
    expect(result).toContain('"source":"exercise"');
  });
});

describe("ask with a problemId", () => {
  const ask = (problemId: string) =>
    mockToolModel(
      [
        [
          {
            toolName: "ask",
            input: {
              kind: "problem",
              prompt: "Compute the thrust.",
              kcIds: [MAP.thrust],
              problemId,
            },
          },
        ],
      ],
      "Go on.",
    );

  test("stores the Problem's Exercise on the question", async () => {
    seedExercises();
    useMockModels({ chat: ask("ex-3") });
    await send(firstMessage());
    expect(db.tables.questions).toMatchObject([{ exercise_id: "ex-3" }]);
  });

  test("refuses an unknown problemId, naming findProblems", async () => {
    seedExercises();
    useMockModels({ chat: ask("made-up") });
    await send(firstMessage());
    expect(db.tables.questions).toEqual([]);
    expect(db.tables.chat_messages.at(-1)!.parts).toContainEqual(
      expect.objectContaining({
        type: "tool-ask",
        errorText: expect.stringContaining("findProblems"),
      }),
    );
  });
});

describe("findProblems", () => {
  test("gives the model old-exam Exercises first with solutions, labels and links", async () => {
    const model = finderModel([MAP.thrust], "Try Ex. 1 first.");
    useMockModels({ chat: model });
    seedExercises();

    const reply = await send(firstMessage());

    expect(reply.text).toBe("Try Ex. 1 first.");
    const result = promptOf(model, 1);
    expect(result.indexOf("Ex. 1")).toBeLessThan(result.indexOf("Ex. 3"));
    expect(result).toContain("Compute the thrust of the engine.");
    // The paired solution chunk, labelled disputed.
    expect(result).toContain("Solution: 42 kN.");
    expect(result).toContain("check it before relying on it");
    // The generated solution, labelled as such.
    expect(result).toContain("Generated: thrust is proportional");
    expect(result).toContain("generated by the AI");
    expect(result).toContain(
      `/courses/${COURSE}/materials/${EXAM}#chunk-${chunkOf(1)}`,
    );
    expect(result).toContain("Thrust equation");
  });

  test("skips Exercises the Student has attempted, and says when none are left", async () => {
    seedExercises();
    answered("ex-1", "none", new Date().toISOString());

    const first = finderModel();
    useMockModels({ chat: first });
    await send(firstMessage());
    answered("ex-3", "none", new Date().toISOString());
    const second = finderModel();
    useMockModels({ chat: second });
    await send(firstMessage());

    expect(promptOf(first, 1)).toContain("Ex. 3");
    expect(promptOf(first, 1)).not.toContain("Ex. 1");
    expect(promptOf(second, 1)).toContain(
      "The Student has tried every Exercise of this Course for these KCs",
    );
  });

  test("says when the Course has no Exercises for the KCs", async () => {
    const model = finderModel([MAP.efficiency]);
    useMockModels({ chat: model });
    seedExercises();

    await send(firstMessage());

    expect(promptOf(model, 1)).toContain(
      "This Course has no Exercises for these KCs",
    );
  });

  test("refuses ids of no KC of the Course, and the reply continues", async () => {
    const model = finderModel(["made-up"], "Let's go on.");
    useMockModels({ chat: model });
    seedExercises();

    const reply = await send(firstMessage());

    expect(reply.text).toBe("Let's go on.");
    expect(db.tables.chat_messages.at(-1)!.parts).toContainEqual(
      expect.objectContaining({
        type: "tool-findProblems",
        errorText: expect.stringContaining(
          "These are no KC ids of this Course: made-up.",
        ),
      }),
    );
  });
});
