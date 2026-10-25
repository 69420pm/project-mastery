// @vitest-environment node
import { expect, test, vi } from "vitest";
import { mockToolModel, useMockModels } from "@/lib/ai/testing";
import { loadFixture } from "./eval";
import { checkSession, learnEval, type SessionRecord } from "./learn";

vi.mock("server-only", () => ({}));

/** The ids the eval gives the first gold KC, E1, and its first question. */
const E1 = "00000000-0000-4000-8000-000000000100";
const FIRST_QUESTION = "00000000-0000-4000-8000-000000001000";

const passed = (checks: Array<{ name: string; value: number }>) =>
  Object.fromEntries(checks.map(({ name, value }) => [name, value]));

test("the fixture has the two scripted Students", async () => {
  const { items } = await loadFixture(learnEval);
  expect(items.map((item) => item.id)).toEqual([
    "mostly-right",
    "planted-errors",
  ]);
});

test("a session asks, grades against the labels and ends at close", async () => {
  useMockModels({
    chat: mockToolModel(
      [
        [
          {
            toolName: "ask",
            input: { kind: "question", prompt: "Q?", kcIds: [E1] },
          },
        ],
        [
          {
            toolName: "grade",
            input: {
              questionId: FIRST_QUESTION,
              results: [{ kcId: E1, result: "full" }],
              help: "none",
            },
          },
        ],
        [{ toolName: "setStage", input: { stage: "close", reason: "Test." } }],
      ],
      "Well done.",
    ),
  });
  // No pacing between the mock's calls.
  vi.stubEnv("LEARN_EVAL_RPM", "60000");
  const output = await learnEval.task({
    answers: [
      {
        stage: "orient",
        kind: "any",
        text: "Forces pair.",
        labels: { E1: "full" },
      },
    ],
  });
  const record = JSON.parse(output) as SessionRecord;

  expect(record.stages).toEqual(["orient", "close"]);
  expect(record.end).toBe("close");
  expect(passed(checkSession(record))).toMatchObject({
    stage_order: 1,
    ask_kc_ids: 1,
    grades_match_labels: 1,
    reaches_close: 1,
    // No work question.
    work_kcs: 0,
  });
});

test("a final value the AI shows before the Student's attempt fails", () => {
  const record: SessionRecord = {
    stages: ["orient"],
    readingLeft: [true],
    asks: [],
    answers: [],
    grades: [],
    timeline: [
      { by: "ai", text: "So $F = 20{,}000\\,\\text{N}$. Your turn:" },
      { by: "student", text: "20 kN", finalValues: ["20000 N"] },
    ],
    finalValues: ["20000 N"],
    refusals: [],
    calls: 1,
    costUsd: 0,
    end: "replies",
  };
  expect(passed(checkSession(record)).no_early_final_value).toBe(0);
});
