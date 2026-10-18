import { expect, test } from "vitest";
import type { ChatUIMessage } from "@/features/chat/types";
import { replySegments } from "./reply-steps";

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
      : `${segment.step.state}: ${segment.step.summary}`,
  );
}

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

test("a recorded attempt names each KC's result, the help and the Exercise", () => {
  const [, recorded] = replySegments(
    [
      {
        type: "tool-findExercises",
        toolCallId: "1",
        state: "output-available",
        input: { kcIds: ["a"] },
        output: { exercises: [{ id: "e1", name: "Ex. 3" }] },
      },
      {
        type: "tool-recordAttempt",
        toolCallId: "2",
        state: "output-available",
        input: {
          exerciseId: "e1",
          help: "some",
          kcs: [
            { kcId: "a", correct: true },
            { kcId: "b", correct: false },
          ],
        },
        output: {
          kcs: [
            { id: "a", name: "A", level: 3, nextReview: "2026-10-20" },
            { id: "b", name: "B", level: 1, nextReview: "2026-10-17" },
          ],
        },
      },
    ],
    live,
  );
  expect(recorded).toMatchObject({
    step: {
      summary: "Recorded: A ✓, B ✗ · some help",
      detail: { tool: "recordAttempt", exercise: "Ex. 3" },
    },
  });
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
  ["recordAttempt", "Recording an attempt"],
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
        type: "tool-recordAttempt",
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
      summary: "Recording an attempt failed",
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

test("a recorded attempt names a KC it did not grade, an unseen Exercise by id, and no unknown help", () => {
  const [recorded] = replySegments(
    [
      {
        type: "tool-recordAttempt",
        toolCallId: "1",
        state: "output-available",
        input: {
          exerciseId: "e9",
          help: "lots",
          kcs: [{ kcId: "a", correct: true }],
        },
        output: {
          kcs: [
            { id: "a", name: "A", level: 3, nextReview: "2026-10-20" },
            { id: "b", name: "B", level: 1, nextReview: "2026-10-17" },
          ],
        },
      },
    ],
    live,
  );
  expect(recorded).toMatchObject({
    step: {
      summary: "Recorded: A ✓, B",
      detail: {
        tool: "recordAttempt",
        exercise: "e9",
        kcs: [
          { id: "a", correct: true },
          { id: "b", correct: undefined },
        ],
      },
    },
  });
});

test.each([
  ["none", "Recorded: A ✗ · no help"],
  ["solution_shown", "Recorded: A ✗ · solution shown"],
])("a recorded attempt with help %s reads %s", (help, summary) => {
  expect(
    summaries([
      {
        type: "tool-recordAttempt",
        toolCallId: "1",
        state: "output-available",
        input: { help, kcs: [{ kcId: "a", correct: false }] },
        output: {
          kcs: [{ id: "a", name: "A", level: 0, nextReview: "2026-10-17" }],
        },
      },
    ]),
  ).toEqual([`done: ${summary}`]);
});
