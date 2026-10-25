import { expect, test, vi } from "vitest";
import type { ChatUIMessage } from "@/features/chat/types";
import {
  doneReadings,
  questionStates,
  rebuildQuestions,
  replySegments,
  sessionStage,
  sessionTopic,
} from "./reply-steps";

// The study feature's index also exports its Memory card's server action.
vi.mock("server-only", () => ({}));

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
      case "topicMap":
        return `topic map ${segment.topicMap.topicId}`;
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
    input: { kind: "question", prompt: `Question ${id}?`, kcIds: ["a"] },
    ...(state === "output-available" && { output: { questionId: id } }),
  }) as Parts[number];

test("shows an asked question as a question card, and one being asked as a step", () => {
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

test("a graded rebuild of a session with a Topic is followed by a Topic map", () => {
  const rebuild = {
    ...askPart("q1", "output-available"),
    input: { kind: "rebuild", prompt: "Rebuild it.", kcIds: ["a", "b"] },
  } as Parts[number];
  const grade = (questionId: string) =>
    ({
      type: "tool-grade",
      toolCallId: `g-${questionId}`,
      state: "output-available",
      input: { questionId },
      output: { kcs: [{ id: "a", name: "Limits", result: "full" }] },
    }) as Parts[number];
  const context = (session: object | null) => ({
    tutorContext: { session, todayPlan: { next: { id: "t1" } } },
  });
  const messages = [
    {
      id: "1",
      role: "assistant",
      metadata: context({ stage: "rebuild" }),
      parts: [rebuild, askPart("q2", "output-available")],
    },
  ] as ChatUIMessage[];

  const rebuilds = rebuildQuestions(messages);
  const topicId = sessionTopic(messages);
  expect([...rebuilds]).toEqual(["q1"]);
  expect(topicId).toBe("t1");
  expect(
    summaries([grade("q1"), grade("q2")], { ...live, rebuilds, topicId }),
  ).toEqual([
    "done: Graded: Limits full",
    "topic map t1",
    "done: Graded: Limits full",
  ]);
  // Without stages there is no session Topic.
  expect(
    sessionTopic([{ ...messages[0]!, metadata: context(null) }] as never),
  ).toBeNull();
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

test("a reading card is done once a later Student message names its section", () => {
  const reply = (id: string, parts: Parts) =>
    ({ id, role: "assistant", parts }) as ChatUIMessage;
  const student = (id: string, readingSectionId?: string) =>
    ({
      id,
      role: "user",
      ...(readingSectionId && { metadata: { readingSectionId } }),
      parts: [{ type: "text", text: "Done reading." }],
    }) as ChatUIMessage;
  const messages = [
    student("0", "s1"),
    reply("1", [readingPart("r1", "s1"), readingPart("r2", "s2")]),
    // A side message leaves the cards open.
    student("2"),
    student("3", "s1"),
    reply("4", [readingPart("r3", "s1")]),
  ];

  expect([...doneReadings(messages)]).toEqual(["r1"]);
  expect(doneReadings(messages.slice(0, 3)).size).toBe(0);
});

test("the session's stage is the latest setStage that returned, else the latest reply's context", () => {
  const reply = (stage: string | null, parts: Parts = []) =>
    ({
      id: "r",
      role: "assistant",
      metadata: { tutorContext: { session: stage && { stage } } },
      parts,
    }) as unknown as ChatUIMessage;
  const moved = (stage: string, state = "output-available") =>
    ({
      type: "tool-setStage",
      toolCallId: "s",
      state,
      input: { stage },
      output: { stage },
    }) as Parts[number];

  expect(sessionStage([reply(null)])).toBeNull();
  expect(sessionStage([reply("orient", [moved("prime")])])).toBe("prime");
  expect(
    sessionStage([
      reply("orient", [moved("prime")]),
      reply("prime", [moved("read", "input-available")]),
    ]),
  ).toBe("prime");
  expect(summaries([moved("work")])).toEqual(["done: Moved to Work"]);
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
  ["getTopic", "Reading the Topic"],
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
