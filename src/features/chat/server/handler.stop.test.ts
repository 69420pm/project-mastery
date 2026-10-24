// @vitest-environment node
// The chat handler: stopped replies.
// Shared setup and helpers: handler-testing.ts.
import { randomUUID } from "node:crypto";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test, vi } from "vitest";
import { mockTextModel, mockToolModel, useMockModels } from "@/lib/ai/testing";
import {
  STUDENT,
  CLASSMATE,
  COURSE,
  db,
  userMessage,
  post,
  send,
  storedMessages,
  seedChat,
} from "./handler-testing";

vi.mock("server-only", () => ({}));

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

  /** Sends a message and disconnects once `chunk` (its first text) arrives. */
  async function sendAndStop(body: unknown, chunk = '"text-delta"') {
    const disconnect = new AbortController();
    const response = await post(body, disconnect.signal);
    const reader = response
      .body!.pipeThrough(new TextDecoderStream())
      .getReader();
    let received = "";
    while (!received.includes(chunk)) {
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
        model_id: "xiaomi/mimo-v2.6-flash",
      }),
    );
    expect(storedMessages(chatId).map(({ text }) => text)).toEqual([
      "Hi",
      "The first step is ",
    ]);
  });

  test("with no text yet is kept when a tool call has finished", async () => {
    const tool = mockToolModel(
      [[{ toolName: "remember", input: { text: "Likes examples." } }]],
      "",
    );
    const stalled = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            abortSignal?.addEventListener("abort", () =>
              controller.error(abortSignal.reason),
            );
          },
        }),
      }),
    });
    let calls = 0;
    useMockModels({
      chat: new MockLanguageModelV4({
        doStream: (options) =>
          calls++ === 0 ? tool.doStream(options) : stalled.doStream(options),
      }),
    });
    const chatId = randomUUID();

    await sendAndStop(
      { chatId, courseId: COURSE, message: userMessage("Hi") },
      '"tool-output-available"',
    );

    await vi.waitFor(() =>
      expect(db.tables.chat_messages.at(-1)).toMatchObject({
        role: "assistant",
        stopped: true,
        parts: expect.arrayContaining([
          expect.objectContaining({
            type: "tool-remember",
            state: "output-available",
          }),
        ]),
      }),
    );
  });

  test("records an estimated cost of about four characters per token", async () => {
    useMockModels({ chat: stalledModel("The first step is ") });
    const chatId = randomUUID();

    await sendAndStop({ chatId, courseId: COURSE, message: userMessage("Hi") });

    await vi.waitFor(() => expect(db.tables.ai_usage).toHaveLength(1));
    expect(db.tables.ai_usage[0]).toMatchObject({
      owner: STUDENT,
      task: "chat",
      model_id: "xiaomi/mimo-v2.6-flash",
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

describe("a refused send", () => {
  test("does not drop the reply still streaming from the request before it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const answer = mockTextModel("Second reply.");
    useMockModels({
      chat: new MockLanguageModelV4({
        doStream: async (options) => {
          await gate;
          return answer.doStream(options);
        },
      }),
    });
    const first = randomUUID();
    const chatId = seedChat(STUDENT, [
      { id: first, role: "user", parts: [{ type: "text", text: "One" }] },
      { role: "assistant", parts: [{ type: "text", text: "Reply" }] },
    ]);

    const streaming = await post({ chatId, message: userMessage("Two") });
    const refused = await send({ chatId, message: userMessage("One", first) });
    release();
    await streaming.text();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(refused.status).toBe(409);
    expect(storedMessages(chatId).map(({ text }) => text)).toEqual([
      "One",
      "Reply",
      "Two",
      "Second reply.",
    ]);
  });

  test("with a message id taken in another Chat keeps the latest reply", async () => {
    useMockModels({ chat: mockTextModel("Never sent.") });
    const takenId = randomUUID();
    seedChat(CLASSMATE, [
      { id: takenId, role: "user", parts: [{ type: "text", text: "Mine" }] },
    ]);
    const chatId = seedChat(STUDENT);
    const chat = db.tables.chats.find(({ id }) => id === chatId)!;
    chat.latest_reply_id = "streaming-reply";

    const refused = await send({ chatId, message: userMessage("Hi", takenId) });

    expect(refused.status).toBe(409);
    expect(chat.latest_reply_id).toBe("streaming-reply");
  });
});
