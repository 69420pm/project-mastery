import { expect, test } from "vitest";
import { replyActivity } from "./reply-activity";

test("says the AI is thinking before any part has arrived", () => {
  expect(replyActivity([])).toBe("Thinking…");
  expect(replyActivity([{ type: "step-start" }])).toBe("Thinking…");
});

test("names the tool the AI is using", () => {
  expect(
    replyActivity([
      { type: "step-start" },
      {
        type: "tool-readKcs",
        toolCallId: "1",
        state: "input-available",
        input: { kcIds: ["a"] },
      },
    ]),
  ).toBe("Reading your knowledge map…");
});

test.each([
  ["readKcs", "Reading your knowledge map…"],
  ["findExercises", "Looking for exercises…"],
  ["recordAttempt", "Recording your progress…"],
  ["remember", "Making a note…"],
])("while %s runs, says %s", (tool, text) => {
  expect(
    replyActivity([
      {
        type: `tool-${tool}`,
        toolCallId: "1",
        state: "input-available",
        input: {},
      } as Parameters<typeof replyActivity>[0][number],
    ]),
  ).toBe(text);
});

test("falls back to thinking for a tool it does not know", () => {
  expect(
    replyActivity([
      {
        type: "tool-unknown",
        toolCallId: "1",
        state: "input-available",
        input: {},
      },
    ]),
  ).toBe("Thinking…");
});

test("is gone once the reply has text", () => {
  expect(replyActivity([{ type: "text", text: "Let's start" }])).toBeNull();
});

test("keeps naming the tool after it has finished, until text arrives", () => {
  expect(
    replyActivity([
      {
        type: "tool-remember",
        toolCallId: "1",
        state: "output-available",
        input: { text: "x" },
        output: { ok: true },
      },
    ]),
  ).toBe("Making a note…");
});
