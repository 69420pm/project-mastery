// @vitest-environment node
// The Brief handler: stopped and empty replies, and a failed reply's message.
// Shared setup and helpers: handler-testing.ts.
import { APICallError, RetryError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, onTestFinished, test, vi } from "vitest";
import { mockTextModel, useMockModels } from "@/lib/ai/testing";
import { STEP_TIMEOUT_MS } from "@/features/brief/ai/reply";
import {
  COURSE,
  STUDENT,
  db,
  post,
  send,
  stored,
  userMessage,
} from "./handler-testing";

vi.mock("server-only", () => ({}));

/** A Brief whose intake is done. */
function seedDoneBrief() {
  db.tables.briefs.push({
    course_id: COURSE,
    owner: STUDENT,
    exam_date: "2026-12-03",
    goal: "pass",
    open_book: false,
    formula_sheet: false,
    calculator: true,
    scope_confirmed: true,
    notes: null,
  });
}

/** A model that streams `text`, then waits until the call is aborted. */
function stalledModel(text: string) {
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "text-1" });
          controller.enqueue({ type: "text-delta", id: "text-1", delta: text });
          abortSignal?.addEventListener("abort", () =>
            controller.error(abortSignal.reason),
          );
        },
      }),
    }),
  });
}

describe("a reply that is not stored", () => {
  test("a request aborted mid-reply stores no reply", async () => {
    seedDoneBrief();
    useMockModels({ brief: stalledModel("Which of the two ") });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const disconnect = new AbortController();

    const response = await post(
      { courseId: COURSE, message: userMessage("Hi") },
      disconnect.signal,
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

    await vi.waitFor(() =>
      expect(db.tables.ai_usage).toEqual([
        expect.objectContaining({ task: "brief", estimated: true }),
      ]),
    );
    expect(stored().map(({ role }) => role)).toEqual(["assistant", "user"]);
  });

  test("an empty reply without tool calls stores nothing", async () => {
    seedDoneBrief();
    useMockModels({ brief: mockTextModel("") });

    const reply = await send({ courseId: COURSE, message: userMessage("Hi") });

    expect(reply.status).toBe(200);
    expect(stored().map(({ role }) => role)).toEqual(["assistant", "user"]);
    expect(db.tables.ai_usage).toHaveLength(1);
  });
});

/** A model that answers `text` once `release` is called. */
function gatedModel(text: string) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const answer = mockTextModel(text);
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      await gate;
      return answer.doStream(options);
    },
  });
  return { model, release };
}

describe("a reply that comes too late", () => {
  test("is not stored once the Student has written again", async () => {
    seedDoneBrief();
    const { model, release } = gatedModel("About your first message…");
    useMockModels({ brief: model });

    const late = send({ courseId: COURSE, message: userMessage("First") });
    await vi.waitFor(() => expect(model.doStreamCalls).toHaveLength(1));
    // Meanwhile the Student wrote again, as from a reloaded page.
    db.tables.brief_messages.push({
      ...userMessage("Second"),
      course_id: COURSE,
      owner: STUDENT,
      model_id: null,
    });
    release();
    await late;

    expect(stored().map(({ text }) => text)).toEqual([
      expect.any(String),
      "First",
      "Second",
    ]);
  });

  test("a second request for one message stores one reply", async () => {
    seedDoneBrief();
    const { model, release } = gatedModel("Noted.");
    useMockModels({ brief: model });
    const message = userMessage("Closed book.");

    const first = send({ courseId: COURSE, message });
    await vi.waitFor(() => expect(model.doStreamCalls).toHaveLength(1));
    const retry = send({ courseId: COURSE, message });
    await vi.waitFor(() => expect(model.doStreamCalls).toHaveLength(2));
    release();
    await Promise.all([first, retry]);

    expect(stored().map(({ role }) => role)).toEqual([
      "assistant",
      "user",
      "assistant",
    ]);
  });

  test("a step that runs past its time limit fails the reply", async () => {
    seedDoneBrief();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    onTestFinished(() => void vi.useRealTimers());
    const model = stalledModel("Which ");
    useMockModels({ brief: model });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const reply = send({ courseId: COURSE, message: userMessage("Hi") });
    await vi.waitFor(() => expect(model.doStreamCalls).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(STEP_TIMEOUT_MS);

    expect((await reply).error).toBe(
      "The AI took too long to reply. Please try again.",
    );
    expect(stored().map(({ role }) => role)).toEqual(["assistant", "user"]);
  });
});

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

  test.each([
    ["a 429", rateLimited],
    [
      "a 429 after the SDK's retries",
      () =>
        new RetryError({
          message: "Failed after 3 attempts",
          reason: "maxRetriesExceeded",
          errors: [rateLimited(), rateLimited()],
        }),
    ],
  ])("after %s is the busy text", async (_, error) => {
    useMockModels({
      brief: new MockLanguageModelV4({
        doStream: async () => {
          throw error();
        },
      }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const reply = await send({ courseId: COURSE, message: userMessage("Hi") });

    expect(reply.error).toBe(
      "The AI is busy right now. Please try again in a moment.",
    );
    expect(stored().map(({ role }) => role)).toEqual(["assistant", "user"]);
  });
});
