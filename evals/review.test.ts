// @vitest-environment node
import { expect, test, vi } from "vitest";
import { mockToolModel, useMockModels } from "@/lib/ai/testing";
import { loadFixture } from "./eval";
import { checkSession, reviewEval, type ReviewRecord } from "./review";

vi.mock("server-only", () => ({}));

/** The ids the eval gives the gold KCs, the first Topic and the questions. */
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const KC01 = id(0x105);
const KC02 = id(0x106);
const KC03 = id(0x107);
const KC04 = id(0x108);
const KC09 = id(0x10d);
const KC15 = id(0x113);
const BI1 = id(0x10);
const question = (n: number) => id(0x1000 + n);

const ask = (kcIds: string[]) => ({
  toolName: "ask",
  input: { kind: "question", prompt: "Q?", kcIds },
});
const grade = (n: number, results: Array<[string, string]>) => ({
  toolName: "grade",
  input: {
    questionId: question(n),
    results: results.map(([kcId, result]) => ({ kcId, result })),
    help: "none",
  },
});

const scores = (record: ReviewRecord) =>
  Object.fromEntries(checkSession(record).map((c) => [c.name, c.value]));

test("the fixture has the two scripted Students", async () => {
  const { items } = await loadFixture(reviewEval);
  expect(items.map((item) => item.id)).toEqual([
    "mostly-right",
    "planted-errors",
  ]);
});

test("a session that asks each group, re-teaches and retries passes", async () => {
  useMockModels({
    chat: mockToolModel(
      [
        [ask([KC01, KC02, KC03])],
        [
          grade(0, [
            [KC01, "full"],
            [KC02, "partial"],
            [KC03, "full"],
          ]),
          { toolName: "getTopic", input: { topicId: BI1, kcIds: [KC02] } },
        ],
        [ask([KC09])],
        [grade(1, [[KC09, "full"]]), ask([KC04])],
        [grade(2, [[KC04, "full"]]), ask([KC02])],
        [grade(3, [[KC02, "full"]]), ask([KC15])],
        [grade(4, [[KC15, "full"]])],
      ],
      "All done: end the session when you like.",
    ),
  });
  // No pacing between the mock's calls.
  vi.stubEnv("LEARN_EVAL_RPM", "60000");
  const output = await reviewEval.task({
    answers: [
      {
        text: "Group one.",
        labels: { KC01: "full", KC02: "below_full", KC03: "full" },
      },
      { text: "Thrust, again.", labels: { KC02: "full" } },
      { text: "Sections.", labels: { KC09: "full" } },
      { text: "Equation.", labels: { KC04: "full" } },
      { text: "Brayton.", labels: { KC15: "full" } },
    ],
  });
  const record = JSON.parse(output) as ReviewRecord;

  expect(record.queue.map((g) => g.kcIds)).toEqual([
    ["KC01", "KC02", "KC03"],
    ["KC09"],
    ["KC04"],
    ["KC15"],
  ]);
  expect(record.end).toBe("wrap_up");
  expect(scores(record)).toMatchObject({
    one_ask_per_group: 1,
    interleaved: 1,
    reteach_and_retry: 1,
    first_attempts_schedule: 1,
    grades_match_labels: 1,
    wraps_up: 1,
  });
});

test("an immediate retry and two groups of one Topic in a row fail", () => {
  const record: ReviewRecord = {
    queue: [
      { topicId: "BI1", kcIds: ["KC01"] },
      { topicId: "BI2", kcIds: ["KC09"] },
      { topicId: "BI1", kcIds: ["KC04"] },
    ],
    events: [
      { type: "ask", id: "q0", kcIds: ["KC01"] },
      { type: "answer", questionId: "q0", labels: { KC01: "below_full" } },
      { type: "read", kcIds: ["KC01"] },
      { type: "ask", id: "q1", kcIds: ["KC01"] },
      { type: "ask", id: "q2", kcIds: ["KC04"] },
      { type: "ask", id: "q3", kcIds: ["KC09"] },
    ],
    replays: [],
    refusals: [],
    calls: 4,
    costUsd: 0,
    end: "replies",
  };
  expect(scores(record)).toMatchObject({
    one_ask_per_group: 1,
    interleaved: 0,
    reteach_and_retry: 0,
  });
});
