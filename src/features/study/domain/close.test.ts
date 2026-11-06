import { describe, expect, test } from "vitest";
import { buildCloseInput, type CloseSource } from "./close";

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
    memory: "x".repeat(3_001),
  };

  test("keeps the messages' text, leaves tool calls out and condenses a long Memory", () => {
    expect(buildCloseInput(source)).toEqual({
      transcript: [
        { role: "student", text: "Hi" },
        { role: "tutor", text: "Let's start." },
      ],
      questions: source.questions,
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
