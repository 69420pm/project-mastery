// @vitest-environment node
// The chat handler: the first message, stored Chats, refusals and the Chat
// title.
// Shared setup and helpers: handler-testing.ts.
import { randomUUID } from "node:crypto";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test, vi } from "vitest";
import { mockTextModel, mockToolModel, useMockModels } from "@/lib/ai/testing";
import {
  MAP,
  seedMap,
  STUDENT,
  CLASSMATE,
  COURSE,
  CLASSMATE_COURSE,
  db,
  signInAs,
  userMessage,
  send,
  storedMessages,
  seedChat,
} from "./handler-testing";

vi.mock("server-only", () => ({}));

describe("a first message", () => {
  test("creates the Chat and stores the message with the AI's reply and its model", async () => {
    useMockModels({ chat: mockTextModel("Show me your attempt first.") });
    const chatId = randomUUID();

    const reply = await send({
      chatId,
      courseId: COURSE,
      message: userMessage("What is a derivative?"),
    });

    expect(reply.status).toBe(200);
    expect(reply.text).toBe("Show me your attempt first.");
    expect(db.tables.chats).toEqual([
      expect.objectContaining({
        id: chatId,
        owner: STUDENT,
        course_id: COURSE,
      }),
    ]);
    expect(storedMessages(chatId)).toEqual([
      { role: "user", text: "What is a derivative?", modelId: null },
      {
        role: "assistant",
        text: "Show me your attempt first.",
        modelId: "xiaomi/mimo-v2.6-flash",
      },
    ]);
    expect(db.tables.study_sessions).toEqual([
      expect.objectContaining({
        owner: STUDENT,
        chat_id: chatId,
        course_id: COURSE,
        mode: "learn",
        ended_at: null,
      }),
    ]);
  });
});

describe("a message to a stored Chat", () => {
  test("sends the instructions and the full stored history to the model", async () => {
    const model = mockTextModel("Right, the chain rule.");
    useMockModels({ chat: model });
    const chatId = seedChat(STUDENT, [
      {
        role: "user",
        parts: [{ type: "text", text: "What is a derivative?" }],
      },
      {
        role: "assistant",
        parts: [{ type: "text", text: "What do you think it is?" }],
        model_id: "google/gemini-3.5-flash-lite",
      },
    ]);

    await send({ chatId, message: userMessage("A rate of change?") });

    const prompt = model.doStreamCalls[0]?.prompt ?? [];
    expect(prompt.map(({ role }) => role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(JSON.stringify(prompt.at(-1))).toContain("A rate of change?");
    expect(storedMessages(chatId).map(({ text }) => text)).toEqual([
      "What is a derivative?",
      "What do you think it is?",
      "A rate of change?",
      "Right, the chain rule.",
    ]);
  });

  test("retrying a failed reply answers the stored message again without storing it twice", async () => {
    useMockModels({ chat: mockTextModel("Second try.") });
    const messageId = randomUUID();
    const chatId = seedChat(STUDENT, [
      { id: messageId, role: "user", parts: [{ type: "text", text: "Help?" }] },
    ]);

    await send({ chatId, message: userMessage("Help?", messageId) });

    expect(storedMessages(chatId).map(({ text }) => text)).toEqual([
      "Help?",
      "Second try.",
    ]);
  });

  test("regenerating replaces the last reply without keeping the old one", async () => {
    useMockModels({ chat: mockTextModel("A different explanation.") });
    const messageId = randomUUID();
    const chatId = seedChat(STUDENT, [
      { id: messageId, role: "user", parts: [{ type: "text", text: "Why?" }] },
      {
        role: "assistant",
        parts: [{ type: "text", text: "Because." }],
        model_id: "google/gemini-3.5-flash-lite",
        stopped: true,
      },
    ]);

    await send({ chatId, message: userMessage("Why?", messageId) });

    expect(storedMessages(chatId).map(({ text }) => text)).toEqual([
      "Why?",
      "A different explanation.",
    ]);
    expect(db.tables.chat_messages.at(-1)).toMatchObject({ stopped: false });
  });

  test("a failed regenerate keeps the last reply", async () => {
    useMockModels({
      chat: new MockLanguageModelV4({
        doStream: async () => {
          throw new Error("Model unavailable");
        },
      }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const messageId = randomUUID();
    const chatId = seedChat(STUDENT, [
      { id: messageId, role: "user", parts: [{ type: "text", text: "Why?" }] },
      {
        role: "assistant",
        parts: [{ type: "text", text: "Because." }],
        model_id: "google/gemini-3.5-flash-lite",
      },
    ]);

    const reply = await send({
      chatId,
      message: userMessage("Why?", messageId),
    });

    expect(reply.error).toBe("The AI could not reply. Please try again.");
    expect(storedMessages(chatId).map(({ text }) => text)).toEqual([
      "Why?",
      "Because.",
    ]);
  });
});

describe("refusals", () => {
  test("another Student's Chat is refused as not found, without a model call", async () => {
    const model = mockTextModel("Never sent.");
    useMockModels({ chat: model });
    const chatId = seedChat(CLASSMATE, [
      { role: "user", parts: [{ type: "text", text: "Private" }] },
    ]);

    for (const courseId of [undefined, COURSE]) {
      const reply = await send({
        chatId,
        courseId,
        message: userMessage("Let me in"),
      });
      expect(reply).toEqual({
        status: 404,
        refusal: "This chat does not exist.",
      });
    }

    expect(model.doStreamCalls).toHaveLength(0);
    signInAs(CLASSMATE);
    expect(storedMessages(chatId).map(({ text }) => text)).toEqual(["Private"]);
  });

  test("an unknown Chat is refused as not found and not created", async () => {
    useMockModels({ chat: mockTextModel("Never sent.") });

    const reply = await send({
      chatId: randomUUID(),
      message: userMessage("Hello?"),
    });

    expect(reply).toEqual({
      status: 404,
      refusal: "This chat does not exist.",
    });
    expect(db.tables.chats).toEqual([]);
  });

  test("a new Chat in another Student's Course or an unknown Course is refused as not found, without a model call", async () => {
    const model = mockTextModel("Never sent.");
    useMockModels({ chat: model });

    for (const courseId of [CLASSMATE_COURSE, randomUUID()]) {
      const reply = await send({
        chatId: randomUUID(),
        courseId,
        message: userMessage("Let me in"),
      });
      expect(reply).toEqual({
        status: 404,
        refusal: "This course does not exist.",
      });
    }

    expect(model.doStreamCalls).toHaveLength(0);
    expect(db.tables.chats).toEqual([]);
    expect(db.tables.chat_messages).toEqual([]);
  });

  test("a Course deleted just before the Chat is created is refused as not found", async () => {
    const model = mockTextModel("Never sent.");
    useMockModels({ chat: model });
    // The Course is found, then gone when the Chat is inserted.
    const courses = db.tables.courses;
    let reads = 0;
    Object.defineProperty(db.tables, "courses", {
      get: () => (reads++ === 0 ? courses : []),
    });

    const reply = await send({
      chatId: randomUUID(),
      courseId: COURSE,
      message: userMessage("Hello?"),
    });

    expect(reply).toEqual({
      status: 404,
      refusal: "This course does not exist.",
    });
    expect(model.doStreamCalls).toHaveLength(0);
    expect(db.tables.chats).toEqual([]);
  });

  test("a message over 10,000 characters is refused before a Chat is created", async () => {
    const model = mockTextModel("Never sent.");
    useMockModels({ chat: model });

    const reply = await send({
      chatId: randomUUID(),
      courseId: COURSE,
      message: userMessage("x".repeat(10_001)),
    });

    expect(reply).toEqual({
      status: 400,
      refusal: "Your message is too long. Keep it under 10,000 characters.",
    });
    expect(db.tables.chats).toEqual([]);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  test("a message of exactly 10,000 characters is accepted", async () => {
    useMockModels({ chat: mockTextModel("Long one.") });

    const reply = await send({
      chatId: randomUUID(),
      courseId: COURSE,
      message: userMessage("x".repeat(10_000)),
    });

    expect(reply.status).toBe(200);
  });

  test("a signed-out request is refused", async () => {
    signInAs(null);

    const reply = await send({
      chatId: randomUUID(),
      courseId: COURSE,
      message: userMessage("Hi"),
    });

    expect(reply.status).toBe(401);
  });
});

test("a failed reply streams an error and stores no reply", async () => {
  useMockModels({
    chat: new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("Model unavailable");
      },
    }),
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const chatId = randomUUID();

  const reply = await send({
    chatId,
    courseId: COURSE,
    message: userMessage("Hi"),
  });

  expect(reply.error).toBe("The AI could not reply. Please try again.");
  expect(storedMessages(chatId).map(({ role }) => role)).toEqual(["user"]);
});

describe("the Chat title", () => {
  test("after the first reply, the title task names the Chat from the Student's message, recorded as usage", async () => {
    const title = mockTextModel("Derivatives explained");
    useMockModels({ chat: mockTextModel("What do you think?"), title });
    const chatId = randomUUID();

    await send({
      chatId,
      courseId: COURSE,
      message: userMessage("What is a derivative?"),
    });

    expect(db.tables.chats[0]).toMatchObject({
      title: "Derivatives explained",
      title_set_manually: false,
    });
    expect(JSON.stringify(title.doGenerateCalls[0]?.prompt)).toContain(
      "What is a derivative?",
    );
    expect(db.tables.ai_usage).toEqual([
      expect.objectContaining({ task: "chat", chat_id: chatId }),
      expect.objectContaining({
        owner: STUDENT,
        task: "title",
        model_id: "xiaomi/mimo-v2.6-flash",
        input_tokens: 10,
        output_tokens: 20,
        estimated: false,
        chat_id: chatId,
      }),
    ]);
  });

  test("a quoted or overlong title is stored as one short line", async () => {
    useMockModels({
      chat: mockTextModel("Sure."),
      title: mockTextModel(
        `"Limits and continuity of functions in real analysis, with many worked examples and exercises"\nMore text`,
      ),
    });
    const chatId = randomUUID();

    await send({ chatId, courseId: COURSE, message: userMessage("Limits?") });

    expect(db.tables.chats[0]?.title).toBe(
      "Limits and continuity of functions in real analysis, with…",
    );
  });

  test("a Chat that has a title, such as one the Student chose, is never retitled", async () => {
    const title = mockTextModel("Generated");
    useMockModels({ chat: mockTextModel("Again."), title });
    const chatId = seedChat(STUDENT, [
      { role: "user", parts: [{ type: "text", text: "Hi" }] },
    ]);
    Object.assign(db.tables.chats[0]!, {
      title: "My calculus notes",
      title_set_manually: true,
    });

    await send({ chatId, message: userMessage("More?") });

    expect(db.tables.chats[0]?.title).toBe("My calculus notes");
    expect(title.doGenerateCalls).toHaveLength(0);
  });

  test("a failed title call leaves the Chat untitled and keeps the reply", async () => {
    useMockModels({
      chat: mockTextModel("Kept."),
      title: new MockLanguageModelV4({
        doGenerate: async () => {
          throw new Error("Model unavailable");
        },
      }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const chatId = randomUUID();

    const reply = await send({
      chatId,
      courseId: COURSE,
      message: userMessage("Hi"),
    });

    expect(reply.text).toBe("Kept.");
    expect(db.tables.chats[0]?.title).toBeNull();
    expect(storedMessages(chatId).map(({ text }) => text)).toEqual([
      "Hi",
      "Kept.",
    ]);
  });
});

describe("a question on a question card", () => {
  test("is asked, answered by a message that links to it, and graded into attempts", async () => {
    seedMap();
    const chatId = randomUUID();
    useMockModels({
      chat: mockToolModel(
        [
          [
            {
              toolName: "ask",
              input: {
                kind: "question",
                prompt: "State the thrust equation.",
                kcIds: [MAP.thrust],
              },
            },
          ],
        ],
        "Never reached: ask ends the reply.",
      ),
    });

    const asked = await send({
      chatId,
      courseId: COURSE,
      message: userMessage("Quiz me"),
    });

    expect(asked.text).toBe("");
    const [question] = db.tables.questions;
    expect(question).toMatchObject({
      prompt: "State the thrust equation.",
      session_id: db.tables.study_sessions[0]!.id,
    });
    expect(db.tables.question_kcs).toEqual([
      expect.objectContaining({ question_id: question!.id, kc_id: MAP.thrust }),
    ]);

    const model = mockToolModel(
      [
        [
          {
            toolName: "grade",
            input: {
              questionId: question!.id,
              results: [{ kcId: MAP.thrust, result: "partial" }],
              help: "none",
            },
          },
        ],
      ],
      "Close: mind the sign.",
    );
    useMockModels({ chat: model });
    const answer = {
      ...userMessage("$F = \\dot m (v_0 - v_e)$"),
      metadata: { questionId: question!.id },
    };

    const graded = await send({ chatId, message: answer });

    expect(graded.text).toBe("Close: mind the sign.");
    expect(question).toMatchObject({
      answer_text: "$F = \\dot m (v_0 - v_e)$",
      answer_message_id: answer.id,
      graded_at: expect.any(String),
    });
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).toContain(
      `card of question ${question!.id}`,
    );
    expect(db.tables.attempts).toEqual([
      expect.objectContaining({
        question_id: question!.id,
        kc_id: MAP.thrust,
        kind: "learn",
        result: "partial",
      }),
    ]);

    // Graded, the card takes no more answers.
    const late = await send({
      chatId,
      message: { ...userMessage("Again"), metadata: answer.metadata },
    });
    expect(late).toMatchObject({ status: 409 });
  });

  test("an answer whose recording failed is recorded when it is resent", async () => {
    seedMap();
    const chatId = randomUUID();
    useMockModels({
      chat: mockToolModel(
        [
          [
            {
              toolName: "ask",
              input: { kind: "question", prompt: "Q?", kcIds: [MAP.thrust] },
            },
          ],
        ],
        "",
      ),
    });
    await send({ chatId, courseId: COURSE, message: userMessage("Quiz me") });
    const [question] = db.tables.questions;
    const answer = {
      ...userMessage("It is $4$."),
      metadata: { questionId: question!.id },
    };
    useMockModels({ chat: mockTextModel("Failed reply.") });
    await send({ chatId, message: answer });
    // The message was stored, but recording the answer failed.
    Object.assign(question!, {
      answer_text: null,
      answer_message_id: null,
      answered_at: null,
    });

    const model = mockTextModel("Let me grade that.");
    useMockModels({ chat: model });
    const retried = await send({ chatId, message: answer });

    expect(retried.text).toBe("Let me grade that.");
    expect(question).toMatchObject({
      answer_text: "It is $4$.",
      answer_message_id: answer.id,
      answered_at: expect.any(String),
    });
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).toContain(
      `card of question ${question!.id}`,
    );
  });
});
