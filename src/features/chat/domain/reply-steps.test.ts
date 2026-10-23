import { expect, test } from "vitest";
import type { ChatUIMessage } from "@/features/chat/types";
import { questionStates, replySegments } from "./reply-steps";

type Parts = ChatUIMessage["parts"];

const live = { inProgress: true };

const kc = (id: string, name: string) => ({
  id,
  name,
  type: "concept",
  description: `About ${name}`,
  sources: [],
});

/** The one-line summaries of a reply's segments, text as itself. */
function summaries(parts: Parts) {
  return replySegments(parts, live).map((segment) =>
    segment.kind === "text"
      ? segment.text
      : segment.kind === "question"
        ? `question ${segment.question.id}: ${segment.question.prompt}`
        : `${segment.step.state}: ${segment.step.summary}`,
  );
}

const askPart = (id: string, state: "input-available" | "output-available") =>
  ({
    type: "tool-ask",
    toolCallId: `ask-${id}`,
    state,
    input: { kind: "question", prompt: `Question ${id}?`, kcIds: ["a"] },
    ...(state === "output-available" && { output: { questionId: id } }),
  }) as Parts[number];

test("shows an asked question as a task card, and one being asked as a step", () => {
  expect(
    summaries([
      { type: "text", text: "Try this. " },
      askPart("q1", "output-available"),
    ]),
  ).toEqual(["Try this. ", "question q1: Question q1?"]);
  expect(summaries([askPart("q2", "input-available")])).toEqual([
    "running: Asking a question…",
  ]);
});

test("a question is submitted by an answer from its card and graded by grade", () => {
  const graded = [{ id: "a", name: "Limits", result: "partial" }];
  const messages = [
    { id: "1", role: "assistant", parts: [askPart("q1", "output-available")] },
    { id: "2", role: "user", parts: [{ type: "text", text: "On the side" }] },
    {
      id: "3",
      role: "user",
      metadata: { questionId: "q1" },
      parts: [{ type: "text", text: "4" }],
    },
    {
      id: "4",
      role: "assistant",
      metadata: {},
      parts: [askPart("q2", "output-available")],
    },
    {
      id: "5",
      role: "user",
      metadata: { questionId: "q2" },
      parts: [{ type: "text", text: "5" }],
    },
    {
      id: "6",
      role: "assistant",
      parts: [
        {
          type: "tool-grade",
          toolCallId: "g",
          state: "output-available",
          input: { questionId: "q2" },
          output: { kcs: graded },
        },
      ],
    },
  ] as ChatUIMessage[];

  const states = questionStates(messages);

  expect(states.get("q1")).toEqual({ status: "submitted" });
  expect(states.get("q2")).toEqual({ status: "graded", kcs: graded });
  expect(questionStates(messages.slice(0, 2)).get("q1")).toBeUndefined();
});

test("keeps text and tool calls in order, merging text across steps", () => {
  expect(
    summaries([
      { type: "step-start" },
      { type: "text", text: "Let me look. " },
      {
        type: "tool-readKcs",
        toolCallId: "1",
        state: "output-available",
        input: { kcIds: ["a", "b"] },
        output: { kcs: [kc("a", "Limits"), kc("b", "Derivatives")] },
      },
      { type: "step-start" },
      { type: "text", text: "Here " },
      { type: "step-start" },
      { type: "text", text: "we go." },
    ]),
  ).toEqual([
    "Let me look. ",
    "done: Read 2 KCs: Limits, Derivatives",
    "Here we go.",
  ]);
});

test("a call on its way is running, and a failed one carries its error", () => {
  const [running, failed] = replySegments(
    [
      {
        type: "tool-readKcs",
        toolCallId: "1",
        state: "input-streaming",
        input: undefined,
      },
      {
        type: "tool-remember",
        toolCallId: "2",
        state: "output-error",
        input: { text: "x" },
        errorText: "One line, without line breaks.",
      },
    ],
    live,
  );
  expect(running).toMatchObject({
    step: { state: "running", summary: "Reading KCs…", detail: null },
  });
  expect(failed).toMatchObject({
    step: {
      state: "error",
      summary: "Making a note failed",
      errorText: "One line, without line breaks.",
    },
  });
});

test("a call that never returned in a finished reply shows as stopped", () => {
  const [stopped] = replySegments(
    [
      {
        type: "tool-readKcs",
        toolCallId: "1",
        state: "input-available",
        input: { kcIds: ["a"] },
      },
    ],
    { inProgress: false },
  );
  expect(stopped).toMatchObject({
    step: { state: "stopped", summary: "Reading KCs stopped", detail: null },
  });
});

test("summarizes found Exercises, or the note when there are none", () => {
  const exercise = { id: "e1", name: "Ex. 3" };
  expect(
    summaries([
      {
        type: "tool-findExercises",
        toolCallId: "1",
        state: "output-available",
        input: { kcIds: ["a"] },
        output: { exercises: [exercise] },
      },
      {
        type: "tool-findExercises",
        toolCallId: "2",
        state: "output-available",
        input: { kcIds: ["b"] },
        output: { exercises: [], note: "All attempted already." },
      },
    ]),
  ).toEqual(["done: Found 1 Exercise", "done: All attempted already."]);
});

test("a note shows its text, and an unknown tool its name with input and output", () => {
  const [note, other] = replySegments(
    [
      {
        type: "tool-remember",
        toolCallId: "1",
        state: "output-available",
        input: { text: "Prefers examples first" },
        output: { ok: true },
      },
      {
        type: "tool-search",
        toolCallId: "2",
        state: "output-available",
        input: { q: "x" },
        output: [1],
      },
    ],
    live,
  );
  expect(note).toMatchObject({
    step: { summary: "Noted: Prefers examples first" },
  });
  expect(other).toMatchObject({
    step: {
      summary: "search",
      detail: { tool: "other", input: { q: "x" }, output: [1] },
    },
  });
});

test.each([
  ["readKcs", "Reading KCs"],
  ["findExercises", "Finding Exercises"],
  ["remember", "Making a note"],
  ["search", "search"],
])("a running %s call reads %s…", (tool, title) => {
  expect(
    summaries([
      {
        type: `tool-${tool}`,
        toolCallId: "1",
        state: "input-available",
        input: {},
      } as Parts[number],
    ]),
  ).toEqual([`running: ${title}…`]);
});

test("a denied call is a failed step saying it was denied", () => {
  const [denied] = replySegments(
    [
      {
        type: "tool-remember",
        toolCallId: "1",
        state: "output-denied",
        input: {},
        approval: { id: "a", approved: false },
      },
    ],
    live,
  );
  expect(denied).toMatchObject({
    step: {
      state: "error",
      summary: "Making a note failed",
      errorText: "The call was denied.",
      detail: null,
    },
  });
});

test("a note without text input shows as the tool's name", () => {
  expect(
    summaries([
      {
        type: "tool-remember",
        toolCallId: "1",
        state: "output-available",
        input: {},
        output: { ok: true },
      },
    ]),
  ).toEqual(["done: remember"]);
});
