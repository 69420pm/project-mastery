import { describe, expect, test } from "vitest";
import type { z } from "zod";
import {
  endsReply,
  tutorTools,
  type QuestionToGrade,
  type ReadingToShow,
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
  findReading: async () => null,
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
    sessionEnded: false,
    finalAnswers: null,
  };
  const saved: Array<Parameters<TutorToolActions["saveGrade"]>[0]> = [];

  /** Grades with `results` a question stored as `question`. */
  async function grade(
    question: QuestionToGrade | null,
    results: Array<{ kcId: string; result: string }> = [
      { kcId: "kc-a", result: "full" },
      { kcId: "kc-b", result: "wrong" },
    ],
    finalValue?: string,
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
      { questionId: "q-1", results, help: "some", finalValue } as never,
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
      "one from an ended session",
      { ...open, sessionEnded: true },
      undefined,
      "session has ended",
    ],
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

  describe("the numeric check", () => {
    const keyed = (unit: string | null, value: number): QuestionToGrade => ({
      ...open,
      finalAnswers: [{ label: "Result", value, unit }],
    });
    const thrust = keyed("kN", 17.5);

    test.each([
      ["the key's unit", thrust, "17.5 kN", "match"],
      ["another unit of it", thrust, "17500 N", "match"],
      ["no unit, read in the key's", thrust, "17.5", "match"],
      ["0.6% off", thrust, "17.6 kN", "match"],
      ["1.7% off", thrust, "17.8 kN", "mismatch"],
      ["a unit of another quantity", thrust, "17.5 kg", "mismatch"],
      ["kelvin for degrees Celsius", keyed("degC", 300), "573.15 K", "match"],
      ["a percentage for a pure number", keyed(null, 0.508), "50.8 %", "match"],
      ["a unit for a pure number", keyed(null, 0.508), "0.508 m", "mismatch"],
    ])("stores %s as %s", async (_, question, finalValue, check) => {
      await grade(question, undefined, finalValue);
      expect(saved[0]?.check).toBe(check);
    });

    test("a mismatch turns full into partial; a match keeps the verdict", async () => {
      const results = (value: string) =>
        grade(thrust, undefined, value).then(() =>
          saved[0]?.results.map(({ result }) => result),
        );
      expect(await results("20 kN")).toEqual(["partial", "wrong"]);
      expect(await results("17.5 kN")).toEqual(["full", "wrong"]);
    });

    test("applies only with a key and a final value", async () => {
      await grade(open, undefined, "17.5 kN");
      expect(saved[0]?.check).toBeNull();
      await grade(thrust);
      expect(saved[0]?.check).toBeNull();
    });

    test("refuses a final value that is no number", async () => {
      await expect(grade(thrust, undefined, "about 17")).rejects.toThrow(
        "no number with a unit",
      );
      expect(saved).toEqual([]);
    });
  });
});

describe("showReading", () => {
  const section = {
    label: "Lecture 3, pp. 12–14",
    chunks: ["Thrust is $F = \\dot m \\Delta v$."],
    studyText: "In short: thrust is $F$.",
  };
  const show = (found: ReadingToShow | null) =>
    tutorTools({ ...noActions, findReading: async () => found }).showReading
      .execute!({ sectionId: "s-1", purpose: "What makes thrust?" }, {
      toolCallId: "1",
      messages: [],
    } as never);

  test("refuses a section that is no Reading section of the Course", async () => {
    await expect(show(null)).rejects.toThrow(
      "s-1 is no Reading section of this Course",
    );
  });

  test("returns the label, mode and chunks, and the study text only in study_text mode", async () => {
    expect(await show({ ...section, mode: "original" })).toEqual({
      label: "Lecture 3, pp. 12–14",
      mode: "original",
      chunks: section.chunks,
    });
    expect(await show({ ...section, mode: "study_text" })).toEqual({
      label: "Lecture 3, pp. 12–14",
      mode: "study_text",
      chunks: section.chunks,
      studyText: "In short: thrust is $F$.",
    });
  });

  test("takes a purpose of one line of at most 300 characters", () => {
    const purpose = (value: string) =>
      accepts("showReading", { sectionId: "s-1", purpose: value });
    expect(purpose("x".repeat(300))).toBe(true);
    expect(purpose("")).toBe(false);
    expect(purpose("x".repeat(301))).toBe(false);
    expect(purpose("Why?\nHow?")).toBe(false);
  });

  test.each(["showReading", "ask"])("a %s call ends the reply", (toolName) => {
    const step = (name: string) => ({ toolCalls: [{ toolName: name }] });
    expect(endsReply({ steps: [step(toolName)] } as never)).toBe(true);
    expect(endsReply({ steps: [step("readKcs")] } as never)).toBe(false);
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
