// @vitest-environment node
// The chat handler: the first message, stored Chats, the model choice, refusals
// and the Chat title.
// Shared setup and helpers: handler-testing.ts.
import { randomUUID } from "node:crypto";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test, vi } from "vitest";
import { modelChoices } from "@/lib/ai/models";
import { mockTextModel, useMockModels } from "@/lib/ai/testing";
import {
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
        modelId: "google/gemini-3.5-flash-lite",
      },
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

describe("the model choice", () => {
  const defaultChoice = () =>
    modelChoices("chat").find(({ key }) => key === "balanced");

  /** A choice other than the default, so a test can tell them apart. */
  function otherChoice() {
    const choice = modelChoices("chat").find(({ key }) => key !== "balanced");
    if (!choice) throw new Error("The chat task needs a second choice.");
    return choice;
  }

  test("a new Chat answers with the chosen model, stores it on the reply and remembers the choice", async () => {
    useMockModels({ chat: mockTextModel("Chosen.") });
    const choice = otherChoice();
    const chatId = randomUUID();

    await send({
      chatId,
      courseId: COURSE,
      modelChoice: choice.key,
      message: userMessage("Hi"),
    });

    expect(storedMessages(chatId).at(-1)).toMatchObject({
      role: "assistant",
      modelId: choice.model,
    });
    expect(db.tables.chats[0]).toMatchObject({ model_choice: choice.key });
  });

  test("a changed choice applies from the next message on and is remembered", async () => {
    useMockModels({ chat: mockTextModel("Changed.") });
    const choice = otherChoice();
    const chatId = seedChat(STUDENT);

    await send({ chatId, message: userMessage("First") });
    await send({
      chatId,
      modelChoice: choice.key,
      message: userMessage("Second"),
    });

    const replies = storedMessages(chatId).filter(
      ({ role }) => role === "assistant",
    );
    expect(replies.map(({ modelId }) => modelId)).toEqual([
      defaultChoice()?.model,
      choice.model,
    ]);
    expect(db.tables.chats[0]).toMatchObject({ model_choice: choice.key });
  });

  test("without a choice, a stored Chat answers with its last choice", async () => {
    useMockModels({ chat: mockTextModel("Remembered.") });
    const choice = otherChoice();
    const chatId = seedChat(STUDENT);
    db.tables.chats[0]!.model_choice = choice.key;

    await send({ chatId, message: userMessage("Again") });

    expect(storedMessages(chatId).at(-1)?.modelId).toBe(choice.model);
  });

  test("an unknown choice key, such as a raw model id, is refused without a model call", async () => {
    const model = mockTextModel("Never sent.");
    useMockModels({ chat: model });
    const chatId = randomUUID();

    for (const modelChoice of ["turbo", otherChoice().model]) {
      const reply = await send({
        chatId,
        courseId: COURSE,
        modelChoice,
        message: userMessage("Hi"),
      });
      expect(reply).toEqual({
        status: 400,
        refusal: expect.stringMatching(/model/i),
      });
    }

    expect(db.tables.chats).toEqual([]);
    expect(model.doStreamCalls).toHaveLength(0);
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
        model_id: "google/gemini-3.1-flash-lite",
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
