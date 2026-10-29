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

const owned = { owner: STUDENT, course_id: COURSE };

/** The label of Exercise `n`: the exam's on page 1, else Lecture 7's page n. */
const ex = (n: number) => (n === 1 ? "Exam 2024 p. 1" : `Lecture 7 p. ${n}`);

function addChunk(n: number, material: string, markdown: string) {
  db.tables.chunks.push({
    ...owned,
    id: chunkOf(n),
    material_id: material,
    position: n,
    page_from: n,
    page_to: n,
    markdown,
  });
}

/** Exercise `n` on chunk `n`, testing `kcs`. */
function addExercise(
  n: number,
  difficulty: number,
  kcs: string[] = [MAP.thrust],
) {
  db.tables.exercises.push({
    ...owned,
    id: `ex-${n}`,
    question_chunk_id: chunkOf(n),
    difficulty,
    position: n,
  });
  for (const kc of kcs) {
    db.tables.exercise_kcs.push({
      ...owned,
      exercise_id: `ex-${n}`,
      kc_id: kc,
    });
  }
}

/** An exam Exercise with a paired solution, and a lecture one without any. */
function seedExercises() {
  seedMap();
  db.tables.materials.push({
    ...owned,
    id: EXAM,
    name: "Exam 2024",
    is_exam: true,
    created_at: "2025-12-02T00:00:00.000Z",
  });
  addChunk(1, EXAM, "Compute the thrust of the engine.");
  addChunk(2, EXAM, "Solution: 42 kN.");
  addChunk(3, MAP.material, "Why does thrust grow with exhaust speed?");
  addExercise(1, 2);
  addExercise(3, 2);
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

/** A further lecture Exercise, on its own page of Lecture 7. */
function addLectureExercise(n: number, difficulty: number, kcs?: string[]) {
  addChunk(n, MAP.material, `Lecture question ${n}.`);
  addExercise(n, difficulty, kcs);
}

const finderModel = (kcIds: string[] = [MAP.thrust], text = "Here.") =>
  mockToolModel([[{ toolName: "findProblems", input: { kcIds } }]], text);

/** The names of the Problems `findProblems` returned, in order. */
function foundOrder(model: ReturnType<typeof finderModel>) {
  const result = promptOf(model, 1);
  return [ex(3), ex(4), ex(5)]
    .filter((name) => result.includes(name))
    .toSorted((a, b) => result.indexOf(a) - result.indexOf(b));
}

describe("findProblems ranking", () => {
  test("steps up one above the last unassisted success, and ignores help", async () => {
    seedExercises();
    addLectureExercise(4, 3);
    const now = Date.now();
    answered("ex-1", "none", new Date(now - 2000).toISOString());
    const first = finderModel();
    useMockModels({ chat: first });
    await send(firstMessage());
    expect(foundOrder(first)).toEqual([ex(4), ex(3)]);

    db.tables.attempts.length = 0;
    db.tables.questions.length = 0;
    answered("ex-1", "some", new Date(now - 2000).toISOString());
    const second = finderModel();
    useMockModels({ chat: second });
    await send(firstMessage());
    expect(foundOrder(second)).toEqual([ex(3), ex(4)]);
  });

  test("steps up from an older unassisted success, not a newer one with help", async () => {
    seedExercises();
    addLectureExercise(4, 3);
    addLectureExercise(6, 1);
    const now = Date.now();
    answered("ex-6", "none", new Date(now - 4000).toISOString());
    answered("ex-1", "some", new Date(now - 2000).toISOString());
    const model = finderModel();
    useMockModels({ chat: model });
    await send(firstMessage());
    expect(foundOrder(model)).toEqual([ex(3), ex(4)]);
  });

  test("prefers a first KC other than the last Problem's", async () => {
    seedExercises();
    addLectureExercise(5, 2, [MAP.newton, MAP.thrust]);
    answered("ex-1", "some", new Date().toISOString());
    const model = finderModel();
    useMockModels({ chat: model });
    await send(firstMessage());
    expect(foundOrder(model).slice(0, 2)).toEqual([ex(5), ex(3)]);
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

const problemId = (n: number) => `aaaaaaaa-f000-4000-8000-00000000000${n}`;

/** A generated Problem on the thrust KC, ready unless `extra` says else. */
function addProblem(n: number, extra: Record<string, unknown> = {}) {
  const owned = { owner: STUDENT, course_id: COURSE };
  db.tables.problems.push({
    ...owned,
    id: problemId(n),
    source: "new",
    status: "ready",
    original_exercise_id: null,
    difficulty: 2,
    statement: `Generated statement ${n}.`,
    solution: `Generated solution ${n}.`,
    final_answers: null,
    program: null,
    flag: null,
    created_at: `2026-10-25T00:00:0${n}.000Z`,
    ...extra,
  });
  db.tables.problem_kcs.push({
    ...owned,
    problem_id: problemId(n),
    kc_id: MAP.thrust,
  });
}

describe("findProblems with generated Problems", () => {
  test("ranks ready, unflagged, unasked Problems after the Exercises, variants first", async () => {
    seedExercises();
    addProblem(1);
    addProblem(2, {
      source: "variant",
      original_exercise_id: "ex-3",
      program: "F = 50 kg/s * 500 m/s",
    });
    addProblem(3, { flag: "wrong", flagged_at: "2026-10-25T01:00:00.000Z" });
    addProblem(4, { status: "queued", statement: null, solution: null });
    const model = finderModel();
    useMockModels({ chat: model });
    await send(firstMessage());

    const result = promptOf(model, 1);
    expect(result.indexOf(ex(1))).toBeLessThan(result.indexOf(ex(3)));
    expect(result.indexOf(ex(3))).toBeLessThan(
      result.indexOf("Generated statement 2."),
    );
    expect(result).toContain('"source":"variant"');
    expect(result).toContain("computed by code");
    // Only 3: the new Problem ranks last; flagged and queued never come.
    expect(result).not.toContain("Generated statement 1.");
    expect(result).not.toContain("Generated statement 3.");
    expect(result).not.toContain("Generated statement 4.");
  });

  test("gives a new Problem once the Exercises are seen, and skips asked ones", async () => {
    seedExercises();
    addProblem(1);
    addProblem(2);
    answered("ex-1", "none", new Date().toISOString());
    answered("ex-3", "none", new Date().toISOString());
    db.tables.questions.push({
      id: randomUUID(),
      owner: STUDENT,
      session_id: db.tables.study_sessions[0]!.id,
      exercise_id: null,
      problem_id: problemId(2),
      asked_at: new Date().toISOString(),
    });
    const model = finderModel();
    useMockModels({ chat: model });
    await send(firstMessage());

    const result = promptOf(model, 1);
    expect(result).toContain("Generated statement 1.");
    expect(result).toContain('"source":"new"');
    expect(result).toContain("without a program: check it");
    expect(result).not.toContain("Generated statement 2.");
  });
});

describe("ask and grade on a generated Problem", () => {
  const askProblem = (id: string) =>
    mockToolModel(
      [
        [
          {
            toolName: "ask",
            input: {
              kind: "problem",
              prompt: "Compute the thrust.",
              kcIds: [MAP.thrust],
              problemId: id,
            },
          },
        ],
      ],
      "Go on.",
    );

  test("stores the Problem on the question and names it for the card", async () => {
    seedExercises();
    addProblem(1);
    useMockModels({ chat: askProblem(problemId(1)) });
    await send(firstMessage());
    expect(db.tables.questions).toMatchObject([
      { exercise_id: null, problem_id: problemId(1) },
    ]);
    expect(db.tables.chat_messages.at(-1)!.parts).toContainEqual(
      expect.objectContaining({
        type: "tool-ask",
        output: expect.objectContaining({ generatedProblemId: problemId(1) }),
      }),
    );
  });

  test("refuses a queued Problem", async () => {
    seedExercises();
    addProblem(1, { status: "queued", statement: null, solution: null });
    useMockModels({ chat: askProblem(problemId(1)) });
    await send(firstMessage());
    expect(db.tables.questions).toEqual([]);
  });

  test("grade checks the final value against the Problem's key", async () => {
    seedExercises();
    addProblem(1, {
      final_answers: [{ label: "Thrust", value: 25000, unit: "N" }],
    });
    const chatId = randomUUID();
    useMockModels({ chat: askProblem(problemId(1)) });
    await send({ ...firstMessage(), chatId });
    const [question] = db.tables.questions;

    useMockModels({
      chat: mockToolModel(
        [
          [
            {
              toolName: "grade",
              input: {
                questionId: question!.id,
                results: [{ kcId: MAP.thrust, result: "full" }],
                help: "none",
                finalValue: "30 kN",
              },
            },
          ],
        ],
        "Check your numbers.",
      ),
    });
    await send({
      chatId,
      message: {
        ...userMessage("F = 30 kN"),
        metadata: { questionId: question!.id },
      },
    });

    expect(db.tables.attempts).toEqual([
      expect.objectContaining({ result: "partial", check: "mismatch" }),
    ]);
  });
});

describe("findProblems", () => {
  test("gives the model old-exam Exercises first with solutions, labels and links", async () => {
    const model = finderModel([MAP.thrust], "Try the exam first.");
    useMockModels({ chat: model });
    seedExercises();

    const reply = await send(firstMessage());

    expect(reply.text).toBe("Try the exam first.");
    const result = promptOf(model, 1);
    expect(result.indexOf(ex(1))).toBeLessThan(result.indexOf(ex(3)));
    expect(result).toContain("Compute the thrust of the engine.");
    // The paired solution chunk, from the Materials.
    expect(result).toContain("Solution: 42 kN.");
    expect(result).toContain("from the Materials");
    // No solution in the Materials: the AI solves it with the Student.
    expect(result).toContain("none in the Materials");
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

    expect(promptOf(first, 1)).toContain(ex(3));
    expect(promptOf(first, 1)).not.toContain(ex(1));
    expect(promptOf(second, 1)).toContain(
      "The Student has tried every Exercise of this Course for these KCs",
    );
  });

  test("in a review session, gives Exercises last asked over 14 days ago after the unseen ones", async () => {
    seedExercises();
    addLectureExercise(4, 2);
    const daysAgo = (days: number) =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    answered("ex-1", "none", daysAgo(20));
    answered("ex-3", "none", daysAgo(3));

    const learn = finderModel();
    useMockModels({ chat: learn });
    await send(firstMessage());
    const review = finderModel();
    useMockModels({ chat: review });
    await send({ ...firstMessage(), mode: "review" });

    expect(promptOf(learn, 1)).toContain(ex(4));
    expect(promptOf(learn, 1)).not.toContain(ex(1));
    const result = promptOf(review, 1);
    expect(result.indexOf(ex(4))).toBeLessThan(result.indexOf(ex(1)));
    expect(result).not.toContain(ex(3));
  });

  test("leaves the reserved exam's Exercises and source chunks out", async () => {
    seedExercises();
    db.tables.kc_sources.push({
      owner: STUDENT,
      course_id: COURSE,
      kc_id: MAP.thrust,
      chunk_id: chunkOf(1),
    });
    db.tables.briefs.push({
      course_id: COURSE,
      owner: STUDENT,
      reserved_exam_material_id: EXAM,
    });
    const model = mockToolModel(
      [
        [
          { toolName: "findProblems", input: { kcIds: [MAP.thrust] } },
          { toolName: "getTopic", input: { kcIds: [MAP.thrust] } },
        ],
      ],
      "Here.",
    );
    useMockModels({ chat: model });

    await send(firstMessage());

    const result = promptOf(model, 1);
    expect(result).toContain(ex(3));
    expect(result).not.toContain(ex(1));
    expect(result).not.toContain("Compute the thrust of the engine.");
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
