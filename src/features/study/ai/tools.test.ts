// @vitest-environment node
import { asSchema } from "ai";
import { describe, expect, test, vi } from "vitest";
import type { z } from "zod";

vi.mock("server-only", () => ({}));
import {
  endsReply,
  tutorTools,
  type QuestionToGrade,
  type TutorToolActions,
} from "@/features/study/ai/tools";
import type { ReadingView } from "@/features/study/types";

/** The input limits the model meets, read off the tools themselves. */

const noActions = {
  getTopic: async () => null,
  findProblems: async () => ({ problems: [] }),
  remember: async () => {},
  ask: async () => ({ questionId: "q-1", problem: null }),
  findQuestion: async () => null,
  saveGrade: async () => null,
  closeQuestion: async () => false,
  findReading: async () => null,
  searchMaterials: async () => [],
  compute: async () => ({ ok: false, error: "unused" }),
} satisfies TutorToolActions;

const tools = tutorTools(noActions);

const accepts = (name: keyof typeof tools, input: unknown) =>
  (tools[name].inputSchema as z.ZodType).safeParse(input).success;

const kcIds = (n: number) => Array.from({ length: n }, (_, i) => `kc-${i}`);

describe.each([
  ["findProblems", 8],
  ["ask", 12],
  ["getTopic", 12],
] as const)("%s", (name, max) => {
  const input = (ids: string[]) =>
    name === "ask"
      ? { prompt: "Why?", kcIds: ids }
      : name === "getTopic"
        ? { topicId: "t-1", kcIds: ids }
        : { kcIds: ids };
  test(`takes 1 to ${max} KCs`, () => {
    expect(accepts(name, input(kcIds(1)))).toBe(true);
    expect(accepts(name, input(kcIds(max)))).toBe(true);
    expect(accepts(name, input([]))).toBe(false);
    expect(accepts(name, input(kcIds(max + 1)))).toBe(false);
  });
});

describe("getTopic", () => {
  const read = (topic: unknown, input: Record<string, unknown>) =>
    tutorTools({ ...noActions, getTopic: async () => topic as never }).getTopic
      .execute!(input as never, { toolCallId: "1", messages: [] } as never);

  test("takes a Topic without KC ids, or with null", () => {
    expect(accepts("getTopic", { topicId: "t-1" })).toBe(true);
    expect(accepts("getTopic", { topicId: "t-1", kcIds: null })).toBe(true);
  });

  test("returns the Topic, and refuses an id outside the Course", async () => {
    const topic = { id: "t-1", name: "Thrust" };
    await expect(read(topic, { topicId: "t-1" })).resolves.toEqual(topic);
    await expect(read(null, { topicId: "x" })).rejects.toThrow(
      "x is no Topic id of this Course",
    );
  });

  test("reads KCs without a Topic, and then needs their ids", async () => {
    const calls: unknown[][] = [];
    const kcsOnly = { id: null, kcs: [{ id: "kc-1" }] };
    const run = tutorTools({
      ...noActions,
      getTopic: async (...args) => {
        calls.push(args);
        return kcsOnly as never;
      },
    }).getTopic.execute!;
    const options = { toolCallId: "1", messages: [] } as never;
    await expect(run({ kcIds: ["kc-1"] }, options)).resolves.toEqual(kcsOnly);
    expect(calls).toEqual([[null, ["kc-1"]]]);
    await expect(run({ topicId: null }, options)).rejects.toThrow(
      "Give a topicId, or the kcIds",
    );
  });
});

describe("searchMaterials", () => {
  const chunk = {
    chunkId: "c-1",
    material: "Lecture 1",
    pages: "p. 2",
    link: "/m/1#chunk-c-1",
    markdown: "Thrust",
  };
  const search = (found: (typeof chunk)[], query = "thrust") =>
    tutorTools({ ...noActions, searchMaterials: async () => found })
      .searchMaterials.execute!({ query }, {
      toolCallId: "1",
      messages: [],
    } as never);

  test("takes one line of at most 300 characters", () => {
    expect(accepts("searchMaterials", { query: "a".repeat(300) })).toBe(true);
    expect(accepts("searchMaterials", { query: "a".repeat(301) })).toBe(false);
    expect(accepts("searchMaterials", { query: "" })).toBe(false);
    expect(accepts("searchMaterials", { query: "a\nb" })).toBe(false);
  });

  test("returns the chunks as found", async () => {
    await expect(search([chunk])).resolves.toEqual({ chunks: [chunk] });
  });

  test("notes a Course without searchable chunks", async () => {
    await expect(search([])).resolves.toEqual({
      chunks: [],
      note: expect.stringContaining("No chunk"),
    });
  });
});

const openQuestion: QuestionToGrade = {
  id: "q-1",
  kcIds: ["kc-a", "kc-b"],
  retiredKcIds: [],
  answered: true,
  graded: false,
  sessionEnded: false,
  finalAnswers: null,
};

describe("grade", () => {
  const open = openQuestion;
  const saved: Array<Parameters<TutorToolActions["saveGrade"]>[0]> = [];
  const closed: string[] = [];

  /** The tools on the session's newest question `question`. */
  function toolsOn(question: QuestionToGrade | null) {
    saved.length = 0;
    closed.length = 0;
    return tutorTools({
      ...noActions,
      findQuestion: async () => question,
      saveGrade: async (input) => {
        saved.push(input);
        return [];
      },
      closeQuestion: async (id) => {
        closed.push(id);
        return true;
      },
    });
  }

  const options = { toolCallId: "1", messages: [] } as never;

  /** Grades with `results` the session's newest question `question`. */
  async function grade(
    question: QuestionToGrade | null,
    results: Array<{ kcId: string; result: string }> = [
      { kcId: "kc-a", result: "full" },
      { kcId: "kc-b", result: "wrong" },
    ],
    finalValues?: Array<{ label?: string; value: string }>,
  ) {
    return toolsOn(question).grade.execute!(
      { results, help: "some", finalValues } as never,
      options,
    );
  }

  test("stores the results of the open, answered question", async () => {
    await grade(open);
    expect(saved).toEqual([
      expect.objectContaining({ questionId: "q-1", help: "some" }),
    ]);
  });

  test("closeQuestion closes the open question without attempts", async () => {
    await expect(
      toolsOn({ ...open, answered: false }).closeQuestion.execute!({}, options),
    ).resolves.toEqual({ ok: true });
    expect(closed).toEqual(["q-1"]);
    expect(saved).toEqual([]);
  });

  test.each([
    ["no question", null, "no open Question"],
    ["a graded one", { ...open, graded: true }, "no open Question"],
    [
      "one from an ended session",
      { ...open, sessionEnded: true },
      "session has ended",
    ],
  ])("closeQuestion refuses %s", async (_, question, message) => {
    await expect(
      toolsOn(question).closeQuestion.execute!({}, options),
    ).rejects.toThrow(message);
    expect(closed).toEqual([]);
  });

  test("grade's schema requires results and help", async () => {
    // With every field optional and a noAnswer flag, MiMo sent finalValues
    // without results in 4 of 4 replays of a staging reply (2026-11-09).
    const schema = await asSchema(toolsOn(open).grade.inputSchema).jsonSchema;
    expect(schema).toMatchObject({ required: ["results", "help"] });
  });

  test("drops the results of KCs retired since the ask", async () => {
    await grade({ ...open, kcIds: ["kc-a"], retiredKcIds: ["kc-b"] });
    expect(saved[0]?.results).toEqual([{ kcId: "kc-a", result: "full" }]);
    await grade({ ...open, kcIds: [], retiredKcIds: ["kc-a", "kc-b"] });
    expect(saved).toEqual([]);
    expect(closed).toEqual(["q-1"]);
  });

  test.each([
    ["no question", null, undefined, "no open Question"],
    [
      "an unanswered one",
      { ...open, answered: false },
      undefined,
      "not answered",
    ],
    ["a graded one", { ...open, graded: true }, undefined, "no open Question"],
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

  describe("the answer check", () => {
    const key = (label: string, value: string) => ({
      label,
      value,
      anyOrder: false,
    });
    const thrust: QuestionToGrade = {
      ...open,
      finalAnswers: [key("Thrust", "17.5 kN")],
    };
    const two: QuestionToGrade = {
      ...open,
      finalAnswers: [key("A", "[[1, 2], [0, 1]]"), key("b", "n + 1")],
    };
    const partial = [
      { kcId: "kc-a", result: "partial" },
      { kcId: "kc-b", result: "wrong" },
    ];

    test.each([
      ["one unlabelled value", thrust, [{ value: "17500 N" }], "match"],
      [
        "each key by label",
        two,
        [
          { label: "A", value: "[[1, 2], [0, 1]]" },
          { label: "B", value: "1 + n" },
        ],
        "match",
      ],
      [
        "the worst check",
        two,
        [
          { label: "A", value: "[[1, 2], [0, 1]]" },
          { label: "b", value: "n" },
        ],
        "mismatch",
      ],
      [
        "a value code doesn't compare",
        thrust,
        [{ value: "true" }],
        "unchecked",
      ],
    ])("stores %s as %s", async (_, question, finalValues, check) => {
      await grade(question, undefined, finalValues);
      expect(saved[0]?.check).toBe(check);
    });

    test("a mismatch turns full into partial; a match keeps the verdict", async () => {
      const results = (value: string) =>
        grade(thrust, undefined, [{ value }]).then(() =>
          saved[0]?.results.map(({ result }) => result),
        );
      expect(await results("20 kN")).toEqual(["partial", "wrong"]);
      expect(await results("17.5 kN")).toEqual(["full", "wrong"]);
    });

    test("is null without keys, and unchecked for a key without a value", async () => {
      await grade(open, undefined, [{ value: "17.5 kN" }]);
      expect(saved[0]?.check).toBeNull();
      await grade(thrust, partial);
      expect(saved[0]?.check).toBe("unchecked");
    });

    test("refuses a full while a key has no value", async () => {
      await expect(
        grade(two, undefined, [{ label: "A", value: "[[1, 2], [0, 1]]" }]),
      ).rejects.toThrow('give it in finalValues for "b"');
      expect(saved).toEqual([]);
    });

    test("refuses an unknown label and a value mathjs can't read", async () => {
      await expect(
        grade(two, partial, [{ label: "c", value: "1" }]),
      ).rejects.toThrow("A, b");
      await expect(
        grade(thrust, partial, [{ value: "17.5 kN)" }]),
      ).rejects.toThrow("mathjs");
      expect(saved).toEqual([]);
    });
  });
});

describe("showReading", () => {
  const section = {
    label: "Lecture 3, pp. 12–14",
    chunks: ["Thrust is $F = \\dot m \\Delta v$."],
  };
  const show = (found: ReadingView | null) =>
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

  test("returns the label and chunks", async () => {
    expect(await show(section)).toEqual(section);
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
    expect(endsReply({ steps: [step("getTopic")] } as never)).toBe(false);
  });
});

describe("ask", () => {
  const problem = {
    statement: "Compute it.",
    page: null,
    generatedProblemId: "p-1",
  };
  const askWith = (
    posed: typeof problem | null,
    newest: QuestionToGrade | null = null,
  ) =>
    tutorTools({
      ...noActions,
      findQuestion: async () => newest,
      ask: async () => ({ questionId: "q-2", problem: posed }),
    }).ask.execute!({ prompt: "Go.", kcIds: ["k1"], problemId: "p-1" }, {
      toolCallId: "1",
      messages: [],
    } as never);

  test("returns the Problem it poses", async () => {
    expect(await askWith(problem)).toEqual({ questionId: "q-2", problem });
    expect(await askWith(null)).toEqual({ questionId: "q-2" });
  });

  test("is refused while the newest Question is answered but ungraded", async () => {
    await expect(askWith(null, openQuestion)).rejects.toThrow("grade it first");
    // An unanswered one stays ungraded for good; a graded one is done.
    for (const newest of [
      { ...openQuestion, answered: false },
      { ...openQuestion, graded: true },
    ]) {
      await expect(askWith(null, newest)).resolves.toEqual({
        questionId: "q-2",
      });
    }
  });
});

describe("compute", () => {
  const call = (compute: TutorToolActions["compute"], program: string) =>
    tutorTools({ ...noActions, compute }).compute.execute!({ program }, {
      toolCallId: "1",
      messages: [],
    } as never);

  test("runs the program and returns its values", async () => {
    const programs: string[] = [];
    const value = { value: 14, unit: "kN", text: "14 kN" };
    const output = await call(async (program) => {
      programs.push(program);
      return { ok: true, values: { thrust: value }, answers: [] };
    }, "thrust = 14 kN");
    expect(output).toEqual({ values: { thrust: value } });
    expect(programs).toEqual(["thrust = 14 kN"]);
  });

  test("returns a failed run's error as data", async () => {
    const error = "These variable names are mathjs units: m.";
    await expect(
      call(async () => ({ ok: false, error }), "m = 2 kg"),
    ).resolves.toEqual({ error });
  });

  test("takes a program that is not empty", () => {
    expect(accepts("compute", { program: "" })).toBe(false);
    expect(accepts("compute", { program: "x = 1" })).toBe(true);
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
