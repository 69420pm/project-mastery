import { expect, test } from "vitest";
import type { ChatUIMessage } from "@/features/chat/types";
import { replySegments } from "./reply-steps";

type Parts = ChatUIMessage["parts"];

const live = { inProgress: true };

const kc = (id: string, name: string) => ({
  id,
  name,
  description: `About ${name}`,
  sources: [],
});

/** The one-line summaries of a reply's segments, text as itself. */
function summaries(
  parts: Parts,
  options: Parameters<typeof replySegments>[1] = live,
) {
  return replySegments(parts, options).map((segment) => {
    switch (segment.kind) {
      case "text":
        return segment.text;
      case "question":
        return `question ${segment.question.id}: ${segment.question.prompt}`;
      case "reading":
        return `reading ${segment.reading.sectionId}`;
      case "step":
        return `${segment.step.state}: ${segment.step.summary}`;
    }
  });
}

const askPart = (id: string, state: "input-available" | "output-available") =>
  ({
    type: "tool-ask",
    toolCallId: `ask-${id}`,
    state,
    input: { prompt: `Question ${id}?`, kcIds: ["a"] },
    ...(state === "output-available" && { output: { questionId: id } }),
  }) as Parts[number];

test("shows an asked question as its prompt, and one being asked as a step", () => {
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

const readingPart = (callId: string, sectionId: string) =>
  ({
    type: "tool-showReading",
    toolCallId: callId,
    state: "output-available",
    input: { sectionId, purpose: "What makes thrust?" },
    output: { label: "Lecture 3, pp. 12–14", mode: "original", chunks: [] },
  }) as Parts[number];

test("shows an opened reading as a reading card", () => {
  expect(replySegments([readingPart("r1", "s1")], live)).toEqual([
    {
      kind: "reading",
      reading: {
        id: "r1",
        sectionId: "s1",
        label: "Lecture 3, pp. 12–14",
        purpose: "What makes thrust?",
      },
    },
  ]);
});

test("keeps text and tool calls in order, merging text across steps", () => {
  expect(
    summaries([
      { type: "step-start" },
      { type: "text", text: "Let me look. " },
      {
        type: "tool-getTopic",
        toolCallId: "1",
        state: "output-available",
        input: { topicId: "t" },
        output: {
          id: "t",
          name: "Calculus",
          centralQuestion: "What is change?",
          kcs: [kc("a", "Limits"), kc("b", "Derivatives")],
          anchors: [],
          readingSections: [],
        },
      },
      { type: "step-start" },
      { type: "text", text: "Here " },
      { type: "step-start" },
      { type: "text", text: "we go." },
    ]),
  ).toEqual(["Let me look. ", "done: Read Topic Calculus", "Here we go."]);
});

test("a call on its way is running, and a failed one carries its error", () => {
  const [running, failed] = replySegments(
    [
      {
        type: "tool-getTopic",
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
    step: { state: "running", summary: "Reading the Topic…", detail: null },
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
        type: "tool-getTopic",
        toolCallId: "1",
        state: "input-available",
        input: { topicId: "t" },
      },
    ],
    { inProgress: false },
  );
  expect(stopped).toMatchObject({
    step: {
      state: "stopped",
      summary: "Reading the Topic stopped",
      detail: null,
    },
  });
});

test("summarizes found Problems, or the note when there are none", () => {
  const problem = { id: "e1", name: "Ex. 3", source: "exercise" };
  expect(
    summaries([
      {
        type: "tool-findProblems",
        toolCallId: "1",
        state: "output-available",
        input: { kcIds: ["a"] },
        output: { problems: [problem] },
      },
      {
        type: "tool-findProblems",
        toolCallId: "2",
        state: "output-available",
        input: { kcIds: ["b"] },
        output: { problems: [], note: "All attempted already." },
      },
    ]),
  ).toEqual(["done: Found 1 Problem", "done: All attempted already."]);
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
  ["getTopic", "Reading the Topic"],
  ["findProblems", "Finding Problems"],
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
