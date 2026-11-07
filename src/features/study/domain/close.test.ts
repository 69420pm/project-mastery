import { describe, expect, test } from "vitest";
import { buildCloseInput, touchedTopicNotes, type CloseSource } from "./close";

describe("buildCloseInput", () => {
  const source: CloseSource = {
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
    topics: [{ id: "t1", name: "Thrust", note: null }],
    memory: "x".repeat(3_001),
  };

  test("keeps the messages' text, leaves tool calls out and condenses a long Memory", () => {
    expect(buildCloseInput(source)).toEqual({
      transcript: [
        { role: "student", text: "Hi" },
        { role: "tutor", text: "Let's start." },
      ],
      questions: source.questions,
      topics: source.topics,
      memory: source.memory,
      condensesMemory: true,
    });
  });

  test("a short Memory is not condensed", () => {
    expect(buildCloseInput({ ...source, memory: "Short." })).toMatchObject({
      condensesMemory: false,
    });
  });

  test("a session without a Student message gets no call", () => {
    expect(
      buildCloseInput({ ...source, messages: source.messages.slice(1) }),
    ).toBeNull();
  });
});

describe("touchedTopicNotes", () => {
  test("keeps the first note of each touched Topic and drops any other", () => {
    const input = buildCloseInput({
      messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
      questions: [],
      topics: [
        { id: "t1", name: "Thrust", note: "Old." },
        { id: "t2", name: "Nozzles", note: null },
      ],
      memory: "",
    })!;
    expect(
      touchedTopicNotes(input, [
        { topicId: "t1", text: "New." },
        { topicId: "t9", text: "Not touched." },
        { topicId: "t1", text: "Again." },
      ]),
    ).toEqual([{ topicId: "t1", text: "New." }]);
  });
});
