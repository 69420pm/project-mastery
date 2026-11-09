// @vitest-environment node
// The chat handler and the Chat's Study session: an ended or idle session
// takes no more messages. Shared setup and helpers: handler-testing.ts.
import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { mockTextModel, mockToolModel, useMockModels } from "@/lib/ai/testing";
import {
  COURSE,
  MAP,
  STUDENT,
  db,
  seedChat,
  seedMap,
  send,
  startedWorkflows,
  storedMessages,
  userMessage,
} from "./handler-testing";

vi.mock("server-only", () => ({}));

const HOUR_MS = 60 * 60 * 1000;

/** A stored Chat whose newest message was `ago` ms back, with its session. */
function seedSessionChat(ago: number, endedAt: string | null = null) {
  const chatId = seedChat(STUDENT, [
    { role: "user", parts: [{ type: "text", text: "Earlier" }] },
  ]);
  const newest = new Date(Date.now() - ago).toISOString();
  db.tables.chats.find(({ id }) => id === chatId)!.last_message_at = newest;
  db.tables.study_sessions.push({
    id: randomUUID(),
    owner: STUDENT,
    chat_id: chatId,
    course_id: COURSE,
    ended_at: endedAt,
  });
  return { chatId, newest };
}

test("a message to a session idle for over 2 hours ends it at its newest message and is refused", async () => {
  const model = mockTextModel("Never sent.");
  useMockModels({ chat: model });
  const { chatId, newest } = seedSessionChat(2 * HOUR_MS + 1000);

  for (const text of ["Still there?", "Hello?"]) {
    expect(await send({ chatId, message: userMessage(text) })).toEqual({
      status: 409,
      refusal: expect.stringContaining("study session has ended"),
    });
  }

  expect(model.doStreamCalls).toHaveLength(0);
  expect(storedMessages(chatId).map(({ text }) => text)).toEqual(["Earlier"]);
  expect(db.tables.study_sessions[0]!.ended_at).toBe(newest);
  // Its end queues the review stock once.
  expect(db.tables.problem_runs).toEqual([
    { course_id: COURSE, topic_id: null },
  ]);
});

const sessionOf = (chatId: string) =>
  db.tables.study_sessions.find((row) => row.chat_id === chatId)!;

test("the Student's messages after a question are its answer, until it is graded", async () => {
  seedMap();
  const chatId = randomUUID();
  useMockModels({
    chat: mockToolModel(
      [[{ toolName: "ask", input: { prompt: "Why?", kcIds: [MAP.thrust] } }]],
      "",
    ),
  });
  await send({ chatId, courseId: COURSE, message: userMessage("Quiz me") });

  useMockModels({ chat: mockTextModel("Go on.") });
  const answerId = randomUUID();
  await send({ chatId, message: userMessage("Mass flow.", answerId) });
  await send({ chatId, message: userMessage("Times velocity.") });

  expect(db.tables.questions).toEqual([
    expect.objectContaining({
      prompt: "Why?",
      answer_text: "Mass flow.\n\nTimes velocity.",
      answer_message_id: answerId,
      answered_at: expect.any(String),
    }),
  ]);

  db.tables.questions[0]!.graded_at = new Date().toISOString();
  await send({ chatId, message: userMessage("Next one?") });
  expect(db.tables.questions[0]!.answer_text).toBe(
    "Mass flow.\n\nTimes velocity.",
  );
});

test("a session's first reply ends and closes the Course's idle sessions, not a running one", async () => {
  useMockModels({ chat: mockTextModel("What shall we study?") });
  const idle = seedSessionChat(3 * HOUR_MS);
  const running = seedSessionChat(HOUR_MS);

  await send({
    chatId: randomUUID(),
    courseId: COURSE,
    message: userMessage("Hi"),
  });

  expect(sessionOf(idle.chatId).ended_at).toBe(idle.newest);
  expect(sessionOf(running.chatId).ended_at).toBeNull();
  expect(startedWorkflows).toEqual([
    { name: "closeStudySession", args: [sessionOf(idle.chatId).id] },
  ]);
});

test("a message to an ended session is refused, and one within 2 hours is answered", async () => {
  useMockModels({ chat: mockTextModel("Welcome back.") });
  const ended = seedSessionChat(HOUR_MS, new Date().toISOString());
  const running = seedSessionChat(HOUR_MS);

  expect(
    await send({ chatId: ended.chatId, message: userMessage("More?") }),
  ).toMatchObject({ status: 409 });
  expect(
    await send({ chatId: running.chatId, message: userMessage("More?") }),
  ).toMatchObject({ status: 200, text: "Welcome back." });
  expect(db.tables.study_sessions[1]!.ended_at).toBeNull();
});
