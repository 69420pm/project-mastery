// @vitest-environment node
// The chat handler and a Results session (#186): it starts only on the
// Student's graded Mock exam of the Course, goes through its tasks the most
// points lost first, and its graded questions store `retry` attempts.
// Shared setup and helpers: handler-testing.ts.
import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { mockTextModel, mockToolModel, useMockModels } from "@/lib/ai/testing";
import {
  COURSE,
  MAP,
  OTHER_COURSE,
  STUDENT,
  db,
  seedMap,
  send,
  userMessage,
} from "./handler-testing";

vi.mock("server-only", () => ({}));

const MOCK = "eeeeeeee-0000-4000-8000-000000000001";
const PROBLEM = "ffffffff-0000-4000-8000-000000000001";

/** A Mock exam of the Student's with two graded tasks: 4 of 4 and 2 of 6. */
function seedMock(status = "graded", courseId: string = COURSE) {
  const owned = { owner: STUDENT, course_id: courseId };
  const sessionId = randomUUID();
  db.tables.study_sessions.push({
    ...owned,
    id: sessionId,
    chat_id: null,
    mode: "mock",
    topic_id: null,
    stage: null,
    started_at: "2025-12-30T00:00:00.000Z",
    ended_at: "2025-12-30T01:00:00.000Z",
  });
  db.tables.mock_exams.push({ ...owned, id: MOCK, status });
  db.tables.problems.push({
    ...owned,
    id: PROBLEM,
    solution: "Use the momentum balance: F = 12 kN.",
    final_answers: [],
  });
  const tasks = [
    {
      prompt: "Name the stages.",
      answer: "Intake, compression.",
      awarded: 4,
      points: 4,
      problem: null,
    },
    {
      prompt: "Compute the thrust.",
      answer: "F = -12 kN",
      awarded: 2,
      points: 6,
      problem: PROBLEM,
    },
  ];
  tasks.forEach((task, position) => {
    const questionId = randomUUID();
    db.tables.questions.push({
      id: questionId,
      owner: STUDENT,
      session_id: sessionId,
      kind: "mock_item",
      prompt: task.prompt,
      answer_text: task.answer,
    });
    db.tables.question_kcs.push({ question_id: questionId, kc_id: MAP.thrust });
    db.tables.mock_items.push({
      id: randomUUID(),
      owner: STUDENT,
      mock_id: MOCK,
      position,
      prompt: task.prompt,
      points: task.points,
      points_awarded: task.awarded,
      steps: [{ points: task.awarded, reason: `Reason ${position + 1}.` }],
      exercise_id: null,
      problem_id: task.problem,
      question_id: questionId,
    });
  });
}

const sessionOf = (chatId: string) =>
  db.tables.study_sessions.find((row) => row.chat_id === chatId)!;

test("a results Chat on a graded mock goes through its tasks, the most points lost first", async () => {
  seedMap();
  seedMock();
  const model = mockTextModel("How did you approach task 2?");
  useMockModels({ chat: model });
  const chatId = randomUUID();

  const reply = await send({
    chatId,
    courseId: COURSE,
    mode: "results",
    mockId: MOCK,
    message: userMessage("Hi"),
  });

  expect(reply.status).toBe(200);
  expect(sessionOf(chatId)).toMatchObject({ mode: "results", mock_id: MOCK });
  const prompt = JSON.stringify(model.doStreamCalls[0]!.prompt);
  expect(prompt).toContain("how they approached it");
  expect(prompt).toContain("Task 2: 2 of 6 points");
  expect(prompt).toContain("F = 12 kN");
  expect(prompt).toContain("F = -12 kN");
  expect(prompt.indexOf("Task 2:")).toBeLessThan(prompt.indexOf("Task 1:"));
});

test.each([
  ["a mock not graded yet", "submitted", COURSE],
  ["a mock of another Course", "graded", OTHER_COURSE],
])("%s starts no results session", async (_, status, courseId) => {
  seedMap();
  seedMock(status, courseId);
  const model = mockTextModel("Hello.");
  useMockModels({ chat: model });
  const chatId = randomUUID();

  await send({
    chatId,
    courseId: COURSE,
    mode: "results",
    mockId: MOCK,
    message: userMessage("Hi"),
  });

  expect(sessionOf(chatId).mode).toBe("learn");
  expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).not.toContain(
    "Results session",
  );
});

test("a question graded in a results session stores retry attempts", async () => {
  seedMap();
  seedMock();
  const chatId = randomUUID();
  useMockModels({
    chat: mockToolModel(
      [
        [
          {
            toolName: "ask",
            input: {
              kind: "question",
              prompt: "Which sign does the thrust have?",
              kcIds: [MAP.thrust],
            },
          },
        ],
      ],
      "Never reached: ask ends the reply.",
    ),
  });
  await send({
    chatId,
    courseId: COURSE,
    mode: "results",
    mockId: MOCK,
    message: userMessage("Hi"),
  });
  const question = db.tables.questions.find(
    (row) => row.session_id === sessionOf(chatId).id,
  )!;

  useMockModels({
    chat: mockToolModel(
      [
        [
          {
            toolName: "grade",
            input: {
              questionId: question.id,
              results: [{ kcId: MAP.thrust, result: "full" }],
              help: "none",
            },
          },
        ],
      ],
      "Right.",
    ),
  });
  await send({
    chatId,
    message: {
      ...userMessage("Positive, forward."),
      metadata: { questionId: question.id },
    },
  });

  expect(db.tables.attempts).toEqual([
    expect.objectContaining({
      question_id: question.id,
      kc_id: MAP.thrust,
      kind: "retry",
      result: "full",
    }),
  ]);
});
