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

const promptOf = (model: ReturnType<typeof mockTextModel>, call = 0) =>
  JSON.stringify(model.doStreamCalls[call]!.prompt);

const sessionOf = (chatId: string) =>
  db.tables.study_sessions.find((row) => row.chat_id === chatId)!;

test("the first reply sets the plan's next Topic and starts at orient; setStage moves it on, and the Topic stays", async () => {
  seedMap();
  const chatId = randomUUID();
  const first = mockTextModel("Let's place this Topic.");
  useMockModels({ chat: first });

  await send({ chatId, courseId: COURSE, message: userMessage("Hi") });

  expect(sessionOf(chatId)).toMatchObject({
    topic_id: MAP.topic,
    stage: "orient",
  });
  expect(promptOf(first)).toContain("Session stage: orient.");
  expect(db.tables.problem_runs).toEqual([
    { course_id: COURSE, topic_id: MAP.topic },
  ]);

  const next = mockToolModel(
    [[{ toolName: "setStage", input: { stage: "prime" } }]],
    "A guess first.",
  );
  useMockModels({ chat: next });
  await send({ chatId, message: userMessage("Ready.") });

  expect(sessionOf(chatId)).toMatchObject({
    topic_id: MAP.topic,
    stage: "prime",
  });
  // Only the reply that set the Topic queued its stock.
  expect(db.tables.problem_runs).toHaveLength(1);
});

test("a session resumes at the stage where the Topic's last session stopped", async () => {
  seedMap();
  db.tables.study_sessions.push({
    id: randomUUID(),
    owner: STUDENT,
    chat_id: null,
    course_id: COURSE,
    topic_id: MAP.topic,
    stage: "work",
    started_at: "2025-12-30T00:00:00.000Z",
    ended_at: "2025-12-30T01:00:00.000Z",
  });
  useMockModels({ chat: mockTextModel("Back to work.") });
  const chatId = randomUUID();

  await send({ chatId, courseId: COURSE, message: userMessage("Hi") });

  expect(sessionOf(chatId)).toMatchObject({
    topic_id: MAP.topic,
    stage: "work",
  });
});

test("a Course without Topics gets a session without a Topic or stage", async () => {
  const model = mockTextModel("What shall we study?");
  useMockModels({ chat: model });
  const chatId = randomUUID();

  await send({ chatId, courseId: COURSE, message: userMessage("Hi") });

  expect(sessionOf(chatId)).toMatchObject({ topic_id: null, stage: null });
  expect(promptOf(model)).toContain("Session shape");
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

test("a review Chat gets no Topic and is tutored from its review queue", async () => {
  seedMap();
  const chatId = randomUUID();
  const model = mockTextModel("Nothing is due.");
  useMockModels({ chat: model });

  await send({
    chatId,
    courseId: COURSE,
    mode: "review",
    message: userMessage("Hi"),
  });

  expect(sessionOf(chatId)).toMatchObject({ topic_id: null, stage: null });
  expect(promptOf(model)).toContain("nothing is due for review");
  expect(promptOf(model)).not.toContain("Session stage:");
});

test("a practice Chat without a learned Topic gets no Topic and says to learn one first", async () => {
  seedMap();
  const chatId = randomUUID();
  const model = mockTextModel("Learn a Topic first.");
  useMockModels({ chat: model });

  await send({
    chatId,
    courseId: COURSE,
    mode: "practice",
    message: userMessage("Hi"),
  });

  expect(sessionOf(chatId)).toMatchObject({ topic_id: null, stage: null });
  expect(promptOf(model)).toContain("learns a Topic first");
  expect(promptOf(model)).not.toContain("Session stage:");
});

test.each(["review", "practice"] as const)(
  "a first message with the mode %s stores the session in that mode",
  async (mode) => {
    useMockModels({ chat: mockTextModel("Hello.") });
    const chatId = randomUUID();

    const reply = await send({
      chatId,
      courseId: COURSE,
      mode,
      message: userMessage("Hi"),
    });

    expect(reply.status).toBe(200);
    expect(db.tables.study_sessions).toEqual([
      expect.objectContaining({ chat_id: chatId, mode }),
    ]);
  },
);
