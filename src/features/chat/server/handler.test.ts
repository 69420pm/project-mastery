// @vitest-environment node
import { randomUUID } from "node:crypto";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { modelChoices } from "@/lib/ai/models";
import { mockTextModel, useMockModels } from "@/lib/ai/testing";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

const STUDENT = "11111111-1111-1111-1111-111111111111";
const CLASSMATE = "22222222-2222-2222-2222-222222222222";

let signedIn: string | null = STUDENT;
let db = createDb();

/** The local tables, with the ownership rules of the real policies. */
function createDb() {
  return fakeSupabase({
    tables: { chats: [], chat_messages: [], ai_usage: [] },
    defaults: {
      chats: () => ({
        owner: signedIn,
        title: null,
        title_set_manually: false,
        model_choice: "balanced",
      }),
      chat_messages: () => ({ model_id: null, stopped: false }),
      ai_usage: () => ({ owner: signedIn, estimated: false, chat_id: null }),
    },
    canAccess: (table, row, tables) => {
      if (table === "chats" || table === "ai_usage") {
        return row.owner === signedIn;
      }
      return tables.chats.some(
        (chat) => chat.id === row.chat_id && chat.owner === signedIn,
      );
    },
  });
}

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));
vi.mock("@/lib/auth/user", () => ({
  getUser: async () => (signedIn ? { id: signedIn, email: undefined } : null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));

const { handleChatRequest } = await import("./handler");

beforeEach(() => {
  signedIn = STUDENT;
  db = createDb();
  vi.stubEnv("AI_DAILY_LIMIT_USD", "");
});

function userMessage(text: string, id: string = randomUUID()) {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function post(body: unknown) {
  return handleChatRequest(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** The text and error parts of a UI message stream, as the client sees them. */
function readStream(body: string) {
  const chunks = body
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice("data: ".length)));
  return {
    text: chunks
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => chunk.delta)
      .join(""),
    error: chunks.find((chunk) => chunk.type === "error")?.errorText,
  };
}

/**
 * Sends a message and reads the whole response: the streamed reply, or the
 * refusal text.
 */
async function send(body: unknown): Promise<{
  status: number;
  text?: string;
  error?: string;
  refusal?: string;
}> {
  const response = await post(body);
  const raw = await response.text();
  return response.ok
    ? { status: response.status, ...readStream(raw) }
    : { status: response.status, refusal: raw };
}

/** The stored messages of a Chat as role and text, in order. */
function storedMessages(chatId: string) {
  return db.tables.chat_messages
    .filter((message) => message.chat_id === chatId)
    .map((message) => ({
      role: message.role,
      text: (message.parts as Array<{ type: string; text?: string }>)
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(""),
      modelId: message.model_id,
    }));
}

function seedChat(owner: string, messages: FakeRow[] = []) {
  const chatId = randomUUID();
  db.tables.chats.push({
    id: chatId,
    owner,
    title: null,
    title_set_manually: false,
    model_choice: "balanced",
    created_at: "2025-12-31T00:00:00.000Z",
  });
  messages.forEach((message, index) =>
    db.tables.chat_messages.push({
      id: randomUUID(),
      chat_id: chatId,
      model_id: null,
      stopped: false,
      created_at: `2025-12-31T00:00:0${index}.000Z`,
      ...message,
    }),
  );
  return chatId;
}

describe("a first message", () => {
  test("creates the Chat and stores the message with the AI's reply and its model", async () => {
    useMockModels({ chat: mockTextModel("Show me your attempt first.") });
    const chatId = randomUUID();

    const reply = await send({
      chatId,
      newChat: true,
      message: userMessage("What is a derivative?"),
    });

    expect(reply.status).toBe(200);
    expect(reply.text).toBe("Show me your attempt first.");
    expect(db.tables.chats).toEqual([
      expect.objectContaining({ id: chatId, owner: STUDENT }),
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
      newChat: true,
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
        newChat: true,
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

    for (const newChat of [false, true]) {
      const reply = await send({
        chatId,
        newChat,
        message: userMessage("Let me in"),
      });
      expect(reply).toEqual({
        status: 404,
        refusal: "This chat does not exist.",
      });
    }

    expect(model.doStreamCalls).toHaveLength(0);
    signedIn = CLASSMATE;
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

  test("a message over 10,000 characters is refused before a Chat is created", async () => {
    const model = mockTextModel("Never sent.");
    useMockModels({ chat: model });

    const reply = await send({
      chatId: randomUUID(),
      newChat: true,
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
      newChat: true,
      message: userMessage("x".repeat(10_000)),
    });

    expect(reply.status).toBe(200);
  });

  test("a signed-out request is refused", async () => {
    signedIn = null;

    const reply = await send({
      chatId: randomUUID(),
      newChat: true,
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
    newChat: true,
    message: userMessage("Hi"),
  });

  expect(reply.error).toBe("The AI could not reply. Please try again.");
  expect(storedMessages(chatId).map(({ role }) => role)).toEqual(["user"]);
});

describe("usage", () => {
  test("every reply records its tokens, model and cost in US dollars", async () => {
    // Mock replies report 10 input and 20 output tokens.
    useMockModels({ chat: mockTextModel("Try it yourself first.") });
    const chatId = randomUUID();

    await send({ chatId, newChat: true, message: userMessage("Hi") });

    expect(db.tables.ai_usage).toEqual([
      expect.objectContaining({
        owner: STUDENT,
        task: "chat",
        model_id: "google/gemini-3.5-flash-lite",
        input_tokens: 10,
        cached_input_tokens: 0,
        output_tokens: 20,
        // 10 × $0.30 + 20 × $2.50 per million tokens.
        cost_usd: expect.closeTo(0.000053, 12),
        estimated: false,
        chat_id: chatId,
      }),
    ]);
  });
});

describe("the Daily limit", () => {
  /** Spend of a Student, today unless `createdAt` says otherwise. */
  function seedSpend(owner: string, costUsd: number, createdAt = new Date()) {
    db.tables.ai_usage.push({
      id: randomUUID(),
      owner,
      task: "chat",
      model_id: "google/gemini-3.5-flash-lite",
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      cost_usd: costUsd,
      estimated: false,
      chat_id: null,
      created_at: createdAt.toISOString(),
    });
  }

  test("once reached, refuses the message before any model call or new Chat", async () => {
    vi.stubEnv("AI_DAILY_LIMIT_USD", "1");
    seedSpend(STUDENT, 0.6);
    seedSpend(STUDENT, 0.4);
    const model = mockTextModel("Never sent.");
    useMockModels({ chat: model });

    const reply = await send({
      chatId: randomUUID(),
      newChat: true,
      message: userMessage("One more?"),
    });

    expect(reply).toEqual({
      status: 429,
      refusal:
        "You've reached today's daily limit. The AI is available again after it resets.",
    });
    expect(model.doStreamCalls).toHaveLength(0);
    expect(db.tables.chats).toEqual([]);
  });

  test("still answers just below the limit, even if the reply goes over", async () => {
    vi.stubEnv("AI_DAILY_LIMIT_USD", "1");
    seedSpend(STUDENT, 0.99999);
    useMockModels({ chat: mockTextModel("Here you go.") });

    const reply = await send({
      chatId: randomUUID(),
      newChat: true,
      message: userMessage("Last one"),
    });

    expect(reply.text).toBe("Here you go.");
    expect(db.tables.ai_usage).toHaveLength(2);
  });

  test("counts neither earlier days' spend nor another Student's", async () => {
    vi.stubEnv("AI_DAILY_LIMIT_USD", "1");
    seedSpend(STUDENT, 5, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
    seedSpend(CLASSMATE, 5);
    useMockModels({ chat: mockTextModel("Sure.") });

    const reply = await send({
      chatId: randomUUID(),
      newChat: true,
      message: userMessage("Hi"),
    });

    expect(reply.text).toBe("Sure.");
  });

  test("without AI_DAILY_LIMIT_USD nothing is blocked", async () => {
    seedSpend(STUDENT, 1_000_000);
    useMockModels({ chat: mockTextModel("No limit.") });

    const reply = await send({
      chatId: randomUUID(),
      newChat: true,
      message: userMessage("Hi"),
    });

    expect(reply.text).toBe("No limit.");
  });
});
