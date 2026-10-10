// @vitest-environment node
// The chat handler: recorded usage and the Daily limit.
// Shared setup and helpers: handler-testing.ts.
import { randomUUID } from "node:crypto";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test, vi } from "vitest";
import { AI_TASKS } from "@/lib/ai/models";
import { mockTextModel, useMockModels } from "@/lib/ai/testing";
import {
  STUDENT,
  CLASSMATE,
  COURSE,
  db,
  userMessage,
  send,
  storedMessages,
} from "./handler-testing";

vi.mock("server-only", () => ({}));

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

  test("a Course deleted while the reply streams drops the reply but still records its usage", async () => {
    const reply = mockTextModel("Gone before I end.");
    const doStream = reply.doStream.bind(reply);
    useMockModels({
      chat: new MockLanguageModelV4({
        doStream: async (options) => {
          // The Course goes, and with it, by cascade, its Chats.
          db.tables.courses.splice(0);
          db.tables.chats.splice(0);
          return doStream(options);
        },
      }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const chatId = randomUUID();

    await send({ chatId, courseId: COURSE, message: userMessage("Hi") });

    expect(
      db.tables.chat_messages.filter(({ role }) => role === "assistant"),
    ).toEqual([]);
    expect(db.tables.ai_usage).toEqual([
      expect.objectContaining({
        owner: STUDENT,
        task: "chat",
        output_tokens: 20,
        chat_id: null,
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
