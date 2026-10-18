// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { useMockModels } from "@/lib/ai/testing";
import type { AdjustInput } from "./adjust-call";

vi.mock("server-only", () => ({}));
beforeEach(() => useMockModels({}));

const { adjustCall } = await import("./adjust-call");

const input: AdjustInput = {
  notes: null,
  findings: [{ text: "Is Ex. 2 right?", answer: "Yes" }],
  bigIdeas: [
    { id: "big-thrust", name: "Thrust", description: "Thrust." },
    { id: "big-cycles", name: "Cycles", description: "Cycles." },
  ],
  kcs: [
    { id: "kc-a", name: "A", description: "A.", bigIdea: "big-cycles" },
    { id: "kc-b", name: "B", description: "B.", bigIdea: null },
  ],
};

const sent = () => {
  const [message] = adjustCall(input).call.messages;
  const [part] = message?.content ?? [];
  return JSON.parse(part?.text ?? "{}");
};

test("sends 1-based aliases, a KC's big idea by its alias and empty notes", () => {
  expect(sent()).toEqual({
    notes: "",
    findings: input.findings,
    bigIdeas: [
      { id: "B1", name: "Thrust", description: "Thrust." },
      { id: "B2", name: "Cycles", description: "Cycles." },
    ],
    kcs: [
      { id: "K1", name: "A", description: "A.", bigIdea: "B2" },
      { id: "K2", name: "B", description: "B.", bigIdea: null },
    ],
  });
});

test("maps the answer's aliases back to the real ids", () => {
  const { entries } = adjustCall(input);
  expect(
    entries({
      entries: [
        { id: "B2", multiplier: 0.5, reason: " Less " },
        { id: "K1", multiplier: 2, reason: "Stressed" },
        { id: "K2", multiplier: 0, reason: "Not examined" },
      ],
    }),
  ).toEqual([
    { id: "big-cycles", multiplier: 0.5, reason: "Less" },
    { id: "kc-a", multiplier: 2, reason: "Stressed" },
    { id: "kc-b", multiplier: 0, reason: "Not examined" },
  ]);
});

// The output schema names the aliases as an enum, so an answer naming an
// unknown alias, or a reason that is empty or over 300 characters, is
// rejected instead of being stored.
test.each([
  ["an unknown alias", { id: "K3", multiplier: 1, reason: "Why" }],
  ["a real id instead of an alias", { id: "kc-a", multiplier: 1, reason: "a" }],
  ["a blank reason", { id: "K1", multiplier: 1, reason: "   " }],
  [
    "a 301-character reason",
    { id: "K1", multiplier: 1, reason: "x".repeat(301) },
  ],
])("rejects %s", (_, entry) => {
  expect(() => adjustCall(input).entries({ entries: [entry] })).toThrow();
});

test("accepts a 300-character reason", () => {
  const reason = "x".repeat(300);
  expect(
    adjustCall(input).entries({
      entries: [{ id: "K2", multiplier: 1, reason }],
    }),
  ).toEqual([{ id: "kc-b", multiplier: 1, reason }]);
});

test("needs a map", () => {
  expect(() => adjustCall({ ...input, bigIdeas: [], kcs: [] })).toThrow(
    "An adjustment needs a map.",
  );
});
