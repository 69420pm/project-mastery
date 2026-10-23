import { describe, expect, test } from "vitest";
import type { z } from "zod";
import {
  tutorTools,
  type QuestionToGrade,
  type TutorToolActions,
} from "@/features/study/ai/tools";

/** The input limits the model meets, read off the tools themselves. */

const noActions = {
  readKcs: async () => [],
  findExercises: async () => ({ exercises: [] }),
  remember: async () => {},
  ask: async () => "q-1",
  findQuestion: async () => null,
  saveGrade: async () => null,
} satisfies TutorToolActions;

const tools = tutorTools(noActions);

const accepts = (name: keyof typeof tools, input: unknown) =>
  (tools[name].inputSchema as z.ZodType).safeParse(input).success;

const kcIds = (n: number) => Array.from({ length: n }, (_, i) => `kc-${i}`);

describe.each(["readKcs", "findExercises", "ask"] as const)("%s", (name) => {
  const input = (ids: string[]) =>
    name === "ask"
      ? { kind: "recall", prompt: "Why?", kcIds: ids }
      : { kcIds: ids };
  test("takes 1 to 8 KCs", () => {
    expect(accepts(name, input(kcIds(1)))).toBe(true);
    expect(accepts(name, input(kcIds(8)))).toBe(true);
    expect(accepts(name, input([]))).toBe(false);
    expect(accepts(name, input(kcIds(9)))).toBe(false);
  });
});

describe("grade", () => {
  const open: QuestionToGrade = {
    kind: "question",
    kcIds: ["kc-a", "kc-b"],
    answered: true,
    graded: false,
  };
  const saved: Array<Parameters<TutorToolActions["saveGrade"]>[0]> = [];

  /** Grades with `results` a question stored as `question`. */
  async function grade(
    question: QuestionToGrade | null,
    results: Array<{ kcId: string; result: string }> = [
      { kcId: "kc-a", result: "full" },
      { kcId: "kc-b", result: "wrong" },
    ],
  ) {
    saved.length = 0;
    const { grade } = tutorTools({
      ...noActions,
      findQuestion: async () => question,
      saveGrade: async (input) => {
        saved.push(input);
        return [];
      },
    });
    return grade.execute!(
      { questionId: "q-1", results, help: "some" } as never,
      { toolCallId: "1", messages: [] } as never,
    );
  }

  test("stores one result per KC of an answered question, pre for a prequestion", async () => {
    await grade(open);
    expect(saved).toEqual([
      expect.objectContaining({
        questionId: "q-1",
        kind: "learn",
        help: "some",
      }),
    ]);
    await grade({ ...open, kind: "prequestion" });
    expect(saved[0]?.kind).toBe("pre");
  });

  test.each([
    ["an unknown question", null, undefined, "no question you asked"],
    [
      "an unanswered one",
      { ...open, answered: false },
      undefined,
      "not answered",
    ],
    ["a graded one", { ...open, graded: true }, undefined, "already graded"],
    [
      "a KC the question does not test",
      open,
      [
        { kcId: "kc-a", result: "full" },
        { kcId: "kc-b", result: "full" },
        { kcId: "kc-c", result: "full" },
      ],
      "each KC the question tests, and no others",
    ],
    [
      "a missing KC",
      open,
      [{ kcId: "kc-a", result: "full" }],
      "each KC the question tests",
    ],
    [
      "a KC twice",
      open,
      [
        { kcId: "kc-a", result: "full" },
        { kcId: "kc-a", result: "wrong" },
      ],
      "each KC once",
    ],
  ])("refuses %s", async (_, question, results, message) => {
    await expect(grade(question, results)).rejects.toThrow(message);
    expect(saved).toEqual([]);
  });
});

test("remember takes one line of at most 300 characters", () => {
  const text = (value: string) => accepts("remember", { text: value });
  expect(text("x".repeat(300))).toBe(true);
  expect(text("")).toBe(false);
  expect(text("x".repeat(301))).toBe(false);
  expect(text("Likes proofs\nHates graphs")).toBe(false);
  expect(text("Likes proofs\r")).toBe(false);
});
