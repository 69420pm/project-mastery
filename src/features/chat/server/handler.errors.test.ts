// @vitest-environment node
// The chat handler: a failed reply's message and a message sent twice.
// Shared setup and helpers: handler-testing.ts.
import { randomUUID } from "node:crypto";
import { APICallError, InvalidToolInputError, RetryError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test, vi } from "vitest";
import { mockTextModel, useMockModels } from "@/lib/ai/testing";
import {
  STUDENT,
  COURSE,
  db,
  userMessage,
  send,
  storedMessages,
  seedChat,
} from "./handler-testing";

vi.mock("server-only", () => ({}));

const BUSY = "The AI is busy right now. Please try again in a moment.";

describe("a failed reply's message", () => {
  const rateLimited = () =>
    new APICallError({
      message: "Too many requests",
      url: "https://example.test",
      requestBodyValues: {},
      statusCode: 429,
      // Not retried, so the test does not wait for the SDK's backoff.
      isRetryable: false,
    });
  const toolInputError = new InvalidToolInputError({
    toolName: "getTopic",
    toolInput: "{}",
    cause: new Error("kcIds is required"),
  });

  test.each([
    ["a 429", rateLimited, BUSY],
    [
      "a 429 after the SDK's retries",
      () =>
        new RetryError({
          message: "Failed after 3 attempts",
          reason: "maxRetriesExceeded",
          errors: [rateLimited(), rateLimited()],
        }),
      BUSY,
    ],
    [
      "a 500",
      () =>
        new APICallError({
          message: "Internal",
          url: "https://example.test",
          requestBodyValues: {},
          statusCode: 500,
          isRetryable: false,
        }),
      "The AI could not reply. Please try again.",
    ],
    ["a tool-input error", () => toolInputError, toolInputError.message],
  ])("after %s", async (_, error, message) => {
    useMockModels({
      chat: new MockLanguageModelV4({
        doStream: async () => {
          throw error();
        },
      }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const reply = await send({
      chatId: randomUUID(),
      courseId: COURSE,
      message: userMessage("Hi"),
    });

    expect(reply.error).toBe(message);
  });
});

describe("a message sent twice", () => {
  test("re-sending a message that has a later Student message is refused with 409, without a model call", async () => {
    const model = mockTextModel("Never sent.");
    useMockModels({ chat: model });
    const first = randomUUID();
    const chatId = seedChat(STUDENT, [
      { id: first, role: "user", parts: [{ type: "text", text: "One" }] },
      { role: "assistant", parts: [{ type: "text", text: "Reply" }] },
      { role: "user", parts: [{ type: "text", text: "Two" }] },
    ]);

    const reply = await send({ chatId, message: userMessage("One", first) });

    expect(reply.status).toBe(409);
    expect(model.doStreamCalls).toHaveLength(0);
    expect(storedMessages(chatId).map(({ text }) => text)).toEqual([
      "One",
      "Reply",
      "Two",
    ]);
  });

  test("a double-submitted first message leaves one Chat with the message once", async () => {
    useMockModels({ chat: mockTextModel("Hello.") });
    const chatId = randomUUID();
    const body = {
      chatId,
      courseId: COURSE,
      message: userMessage("Hi"),
    };

    await Promise.all([send(body), send(body)]);

    expect(db.tables.chats).toHaveLength(1);
    expect(
      storedMessages(chatId).filter(({ role }) => role === "user"),
    ).toHaveLength(1);
  });
});
