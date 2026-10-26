import { describe, expect, test } from "vitest";
import {
  buildCloseInput,
  guardedNotes,
  keepsPinnedLines,
  type CloseSource,
} from "./close";

const MEMORY =
  "!Exam is open book.\n2026-10-20: Likes short answers.\n!Studies at night.";

describe("keepsPinnedLines", () => {
  test("holds when every pinned line is kept word for word", () => {
    expect(
      keepsPinnedLines(
        MEMORY,
        "!Exam is open book.\n!Studies at night.\nShort answers.",
      ),
    ).toBe(true);
  });

  test("fails when a pinned line is removed", () => {
    expect(
      keepsPinnedLines(MEMORY, "!Exam is open book.\nShort answers."),
    ).toBe(false);
  });

  test("fails when a pinned line is reworded", () => {
    expect(
      keepsPinnedLines(MEMORY, "!Exam is open-book.\n!Studies at night."),
    ).toBe(false);
  });

  test("holds for any text when the Memory has no pins", () => {
    expect(keepsPinnedLines("Likes short answers.", "Short.")).toBe(true);
  });
});

test("guardedNotes drops a condensed Memory that loses a pin and keeps the rest", () => {
  const notes = {
    sessionNote: "Thrust.\nNext: nozzles.",
    topicNote: null,
    memoryLines: ["Prefers examples."],
    condensedMemory: "!Exam is open book.",
  };
  expect(guardedNotes(notes, MEMORY)).toEqual({
    ...notes,
    condensedMemory: null,
  });
});

describe("buildCloseInput", () => {
  const source: CloseSource = {
    mode: "learn",
    topicName: "Thrust",
    messages: [
      { role: "user", parts: [{ type: "text", text: "Hi" }] },
      {
        role: "assistant",
        parts: [
          { type: "text", text: "Let's start." },
          { type: "tool-ask", input: { prompt: "Why?" } },
          { type: "data-material", data: {} },
        ],
      },
      { role: "assistant", parts: [{ type: "tool-grade" }] },
    ],
    questions: [
      {
        prompt: "Why?",
        answer: "Mass flow.",
        attempts: [{ kcName: "Thrust", result: "partial", help: "hint" }],
      },
    ],
    topicNote: "Mixes up mass flow.",
    memory: "x".repeat(3_001),
  };

  test("keeps the messages' text, leaves tool calls out and asks for the notes the session gets", () => {
    expect(buildCloseInput(source)).toEqual({
      mode: "learn",
      topic: "Thrust",
      transcript: [
        { role: "student", text: "Hi" },
        { role: "tutor", text: "Let's start." },
      ],
      questions: source.questions,
      topicNote: "Mixes up mass flow.",
      memory: source.memory,
      writesTopicNote: true,
      condensesMemory: true,
    });
  });

  test("a review session writes no Topic note, and a short Memory is not condensed", () => {
    expect(
      buildCloseInput({
        ...source,
        mode: "review",
        topicName: null,
        memory: "Short.",
      }),
    ).toMatchObject({
      writesTopicNote: false,
      topicNote: null,
      condensesMemory: false,
    });
  });

  test("a session without a Student message gets no call", () => {
    expect(
      buildCloseInput({ ...source, messages: source.messages.slice(1) }),
    ).toBeNull();
  });
});
