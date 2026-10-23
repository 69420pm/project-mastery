// @vitest-environment node
import { expect, test } from "vitest";
import { chatTranscript, loadRubric } from "./judge";

test("reads a Chat reply stored as OpenTelemetry GenAI messages", () => {
  const transcript = chatTranscript({
    input: [
      { role: "system", parts: [{ type: "text", content: "Instructions" }] },
      { role: "user", parts: [{ type: "text", content: "Solve 7.2b" }] },
      {
        role: "assistant",
        parts: [{ type: "tool_call", name: "readKcs", arguments: {} }],
      },
      { role: "tool", parts: [{ type: "tool_call_response", response: {} }] },
    ],
    output: [
      {
        role: "assistant",
        parts: [{ type: "text", content: "What have you tried?" }],
      },
    ],
  });

  expect(transcript).toEqual({
    messages: [{ role: "user", text: "Solve 7.2b" }],
    reply: "What have you tried?",
  });
});

test("reads AI SDK messages and a text output", () => {
  expect(
    chatTranscript({
      input: {
        system: "Instructions",
        messages: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: [{ type: "text", text: "Hello!" }] },
          { role: "user", content: [{ type: "text", text: "Help" }] },
        ],
      },
      output: "Sure.",
    }),
  ).toEqual({
    messages: [
      { role: "user", text: "Hi" },
      { role: "assistant", text: "Hello!" },
      { role: "user", text: "Help" },
    ],
    reply: "Sure.",
  });
});

test("a trace without reply text has no transcript", () => {
  expect(chatTranscript({ input: [], output: null })).toBeUndefined();
});

test("loads a rubric and refuses an unknown criterion", async () => {
  await expect(loadRubric("attempt_before_help")).resolves.toMatch(
    /## Pass[\s\S]*## Fail/,
  );
  await expect(loadRubric("width")).rejects.toThrow(
    /Unknown judge criterion: width\. Available: attempt_before_help/,
  );
});
