// @vitest-environment node
// The Brief handler: stopped and empty replies, and a failed reply's message.
// Shared setup and helpers: handler-testing.ts.
import { APICallError, RetryError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test, vi } from "vitest";
import { mockTextModel, useMockModels } from "@/lib/ai/testing";
import {
  COURSE,
  MISMATCH,
  STUDENT,
  db,
  post,
  send,
  stored,
  userMessage,
} from "./handler-testing";

vi.mock("server-only", () => ({}));

/** A Brief whose intake is done, so the reply asks the first open Finding. */
function seedDoneBrief() {
  db.tables.briefs.push({
    course_id: COURSE,
    owner: STUDENT,
    exam_date: "2026-12-03",
    goal: "pass",
    hours_per_week: 5,
    question_style: "written",
    open_book: false,
    formula_sheet: false,
    calculator: true,
    scope_confirmed: true,
    notes: null,
  });
}

const askedAt = (id: string) =>
  db.tables.findings.find((row) => row.id === id)?.asked_at;

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
  test("a request aborted mid-reply stores no reply and asks no Finding", async () => {
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
    expect(askedAt(MISMATCH)).toBeNull();
  });

  test("an empty reply without tool calls stores nothing and asks no Finding", async () => {
    seedDoneBrief();
    useMockModels({ brief: mockTextModel("") });

    const reply = await send({ courseId: COURSE, message: userMessage("Hi") });

    expect(reply.status).toBe(200);
    expect(stored().map(({ role }) => role)).toEqual(["assistant", "user"]);
    expect(askedAt(MISMATCH)).toBeNull();
    expect(db.tables.ai_usage).toHaveLength(1);
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
