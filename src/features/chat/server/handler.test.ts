// @vitest-environment node
import { randomUUID } from "node:crypto";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AI_TASKS, modelChoices } from "@/lib/ai/models";
import { mockTextModel, useMockModels } from "@/lib/ai/testing";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

const STUDENT = "11111111-1111-1111-1111-111111111111";
const CLASSMATE = "22222222-2222-2222-2222-222222222222";
/** The Student's Course, and one of their classmate's. */
const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const CLASSMATE_COURSE = "bbbbbbbb-c000-4000-8000-000000000001";

let signedIn: string | null = STUDENT;
let db = createDb();

/** The local tables, with the ownership rules of the real policies. */
function createDb() {
  return fakeSupabase({
    tables: {
      courses: [
        { id: COURSE, owner: STUDENT, name: "Calculus" },
        { id: CLASSMATE_COURSE, owner: CLASSMATE, name: "Biology" },
      ] as FakeRow[],
      chats: [],
      chat_messages: [],
      ai_usage: [],
    },
    defaults: {
      chats: () => ({
        owner: signedIn,
        title: null,
        title_set_manually: false,
        model_choice: "balanced",
      }),
      chat_messages: () => ({ model_id: null, stopped: false }),
      // Recorded now, as in the database, so it counts towards today's spend.
      ai_usage: () => ({
        owner: signedIn,
        estimated: false,
        chat_id: null,
        created_at: new Date().toISOString(),
      }),
    },
    canAccess: (table, row, tables) => {
      if (table === "chats") {
        return (
          row.owner === signedIn &&
          tables.courses.some(
            (course) =>
              course.id === row.course_id && course.owner === signedIn,
          )
        );
      }
      if (table === "courses" || table === "ai_usage") {
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
    course_id: owner === STUDENT ? COURSE : CLASSMATE_COURSE,
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
    signedIn = null;

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

describe("usage", () => {
  test("every reply records its tokens, model and cost in US dollars", async () => {
    // Mock replies report 10 input and 20 output tokens.
    useMockModels({ chat: mockTextModel("Try it yourself first.") });
    const chatId = randomUUID();

    await send({ chatId, courseId: COURSE, message: userMessage("Hi") });

    const replyUsage = db.tables.ai_usage.filter(({ task }) => task === "chat");
    expect(replyUsage).toEqual([
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

  test("a reply from a gateway fallback is stored and priced as the fallback model", async () => {
    const [fallback] = AI_TASKS.chat.fallbacks;
    useMockModels({ chat: answeredByModel(fallback, "From the fallback.") });
    const chatId = randomUUID();

    await send({ chatId, courseId: COURSE, message: userMessage("Hi") });

    expect(storedMessages(chatId).at(-1)).toMatchObject({
      text: "From the fallback.",
      modelId: fallback,
    });
    expect(db.tables.ai_usage.find(({ task }) => task === "chat")).toEqual(
      expect.objectContaining({
        model_id: fallback,
        // 10 × $0.04 + 20 × $1.28 per million tokens.
        cost_usd: expect.closeTo(0.000026, 12),
      }),
    );
  });

  test("a failed reply records an estimated cost, as the provider reports none", async () => {
    useMockModels({
      chat: new MockLanguageModelV4({
        doStream: async () => {
          throw new Error("Model unavailable");
        },
      }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const chatId = randomUUID();

    await send({ chatId, courseId: COURSE, message: userMessage("Hi") });

    expect(db.tables.ai_usage).toEqual([
      expect.objectContaining({
        task: "chat",
        model_id: "google/gemini-3.5-flash-lite",
        output_tokens: 0,
        estimated: true,
        chat_id: chatId,
      }),
    ]);
    // The input is the instructions plus the history, far more than "Hi".
    expect(db.tables.ai_usage[0]!.input_tokens).toBeGreaterThan(100);
  });
});

/**
 * A model that answers `text` and reports `modelId` as the model that
 * answered, as AI Gateway does when it falls back to another model.
 */
function answeredByModel(modelId: string, text: string) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "response-metadata", modelId },
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: text },
          { type: "text-end", id: "text-1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            usage: {
              inputTokens: {
                total: 10,
                noCache: 10,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 20, text: 20, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  });
}

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
      courseId: COURSE,
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
      courseId: COURSE,
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
      courseId: COURSE,
      message: userMessage("Hi"),
    });

    expect(reply.text).toBe("Sure.");
  });

  test("without AI_DAILY_LIMIT_USD nothing is blocked", async () => {
    seedSpend(STUDENT, 1_000_000);
    useMockModels({ chat: mockTextModel("No limit.") });

    const reply = await send({
      chatId: randomUUID(),
      courseId: COURSE,
      message: userMessage("Hi"),
    });

    expect(reply.text).toBe("No limit.");
  });

  test("a reply that reaches the limit leaves the Chat untitled, without a title call", async () => {
    vi.stubEnv("AI_DAILY_LIMIT_USD", "1");
    // The reply's ~$0.000053 crosses the limit.
    seedSpend(STUDENT, 0.99996);
    const title = mockTextModel("Never generated");
    useMockModels({ chat: mockTextModel("Last reply."), title });

    const reply = await send({
      chatId: randomUUID(),
      courseId: COURSE,
      message: userMessage("Hi"),
    });

    expect(reply.text).toBe("Last reply.");
    expect(title.doGenerateCalls).toHaveLength(0);
    expect(db.tables.chats[0]?.title).toBeNull();
  });
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

describe("a stopped reply", () => {
  /**
   * A model that streams `text`, then waits until the call is aborted, like
   * a reply the Student stops halfway. Its stream ends once `ended` settles
   * after the abort, so a test can let other requests run first.
   */
  function stalledModel(
    text: string,
    ended: Promise<void> = Promise.resolve(),
  ) {
    return new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "text-1" });
            controller.enqueue({
              type: "text-delta",
              id: "text-1",
              delta: text,
            });
            abortSignal?.addEventListener("abort", () => {
              void ended.then(() => controller.error(abortSignal.reason));
            });
          },
        }),
      }),
    });
  }

  /**
   * A model whose first reply stalls until stopped and ends only on
   * `endStopped()`, and which answers later calls with `nextText`.
   */
  function stoppedThenAnswering(stoppedText: string, nextText: string) {
    let endStopped!: () => void;
    const stopped = stalledModel(
      stoppedText,
      new Promise((resolve) => (endStopped = resolve)),
    );
    const next = mockTextModel(nextText);
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: (options) =>
        calls++ === 0 ? stopped.doStream(options) : next.doStream(options),
    });
    return { model, endStopped };
  }

  /** Lets pending database writes of an ended reply finish. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  /** Sends a message and disconnects once the reply's first text arrives. */
  async function sendAndStop(body: unknown) {
    const disconnect = new AbortController();
    const response = await handleChatRequest(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: disconnect.signal,
      }),
    );
    const reader = response
      .body!.pipeThrough(new TextDecoderStream())
      .getReader();
    let received = "";
    while (!received.includes('"text-delta"')) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value;
    }
    disconnect.abort();
    await reader.cancel();
  }

  test("is stored with what was written so far and marked as stopped", async () => {
    useMockModels({ chat: stalledModel("The first step is ") });
    const chatId = randomUUID();

    await sendAndStop({ chatId, courseId: COURSE, message: userMessage("Hi") });

    await vi.waitFor(() =>
      expect(db.tables.chat_messages.at(-1)).toMatchObject({
        role: "assistant",
        stopped: true,
        model_id: "google/gemini-3.5-flash-lite",
      }),
    );
    expect(storedMessages(chatId).map(({ text }) => text)).toEqual([
      "Hi",
      "The first step is ",
    ]);
  });

  test("records an estimated cost of about four characters per token", async () => {
    useMockModels({ chat: stalledModel("The first step is ") });
    const chatId = randomUUID();

    await sendAndStop({ chatId, courseId: COURSE, message: userMessage("Hi") });

    await vi.waitFor(() => expect(db.tables.ai_usage).toHaveLength(1));
    expect(db.tables.ai_usage[0]).toMatchObject({
      owner: STUDENT,
      task: "chat",
      model_id: "google/gemini-3.5-flash-lite",
      cached_input_tokens: 0,
      // "The first step is " has 18 characters.
      output_tokens: 5,
      estimated: true,
      chat_id: chatId,
    });
    // The input is the instructions plus the history, far more than "Hi".
    expect(db.tables.ai_usage[0]!.input_tokens).toBeGreaterThan(100);
    expect(db.tables.ai_usage[0]!.cost_usd).toBeGreaterThan(0);
  });

  test("that ends after the Student regenerated it is not kept next to the new reply", async () => {
    const { model, endStopped } = stoppedThenAnswering(
      "The first step is ",
      "A fresh reply.",
    );
    useMockModels({ chat: model });
    const messageId = randomUUID();
    const chatId = seedChat(STUDENT, [
      { id: messageId, role: "user", parts: [{ type: "text", text: "Why?" }] },
    ]);

    await sendAndStop({ chatId, message: userMessage("Why?", messageId) });
    await send({ chatId, message: userMessage("Why?", messageId) });
    endStopped();
    // The stopped reply's usage counts, whether or not the reply is kept.
    await vi.waitFor(() => expect(db.tables.ai_usage).toHaveLength(2));
    await settle();

    expect(storedMessages(chatId).map(({ text }) => text)).toEqual([
      "Why?",
      "A fresh reply.",
    ]);
  });

  test("that ends after the Student's next message is not stored after it", async () => {
    const { model, endStopped } = stoppedThenAnswering(
      "The first step is ",
      "Next reply.",
    );
    useMockModels({ chat: model });
    const chatId = seedChat(STUDENT);

    await sendAndStop({ chatId, message: userMessage("Why?") });
    await send({ chatId, message: userMessage("Never mind, how?") });
    endStopped();
    await vi.waitFor(() => expect(db.tables.ai_usage).toHaveLength(2));
    await settle();

    expect(storedMessages(chatId).map(({ text }) => text)).toEqual([
      "Why?",
      "Never mind, how?",
      "Next reply.",
    ]);
  });
});
