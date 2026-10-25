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
  getTopic: async () => null,
  findExercises: async () => ({ exercises: [] }),
  remember: async () => {},
  ask: async () => "q-1",
  findQuestion: async () => null,
  saveGrade: async () => null,
  findReading: async () => null,
  loadStage: async () => null,
  saveStage: async () => true,
  searchMaterials: async () => [],
  isKc: () => true,
  findChunk: async () => null,
  saveMapFinding: async () => "f-1",
} satisfies TutorToolActions;

const tools = tutorTools(noActions);

const accepts = (name: keyof typeof tools, input: unknown) =>
  (tools[name].inputSchema as z.ZodType).safeParse(input).success;

const kcIds = (n: number) => Array.from({ length: n }, (_, i) => `kc-${i}`);

describe.each([
  ["findExercises", 8],
  ["ask", 12],
  ["getTopic", 12],
] as const)("%s", (name, max) => {
  const input = (ids: string[]) =>
    name === "ask"
      ? { kind: "recall", prompt: "Why?", kcIds: ids }
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

describe("flagMap", () => {
  const markdown = "Thrust follows from the\n  **change** in momentum.";
  const file = (input: object, actions: Partial<TutorToolActions> = {}) => {
    const saved: unknown[] = [];
    const run = tutorTools({
      ...noActions,
      isKc: (id) => id.startsWith("kc-"),
      findChunk: async (id) => (id === "ch-1" ? { markdown } : null),
      saveMapFinding: async (finding) => {
        saved.push(finding);
        return "f-1";
      },
      ...actions,
    }).flagMap.execute!(
      {
        kind: "missing_link",
        kcId: "kc-1",
        linkedKcId: "kc-2",
        chunkId: "ch-1",
        quote: "the **change**",
        reason: "Thrust builds on momentum.",
        ...input,
      } as never,
      { toolCallId: "1", messages: [] } as never,
    );
    return { run, saved };
  };

  test("saves a Finding whose quote is in its chunk, case and whitespace aside", async () => {
    const { run, saved } = file({ quote: "FOLLOWS from THE  **change**" });
    expect(await run).toEqual({ findingId: "f-1" });
    expect(saved).toEqual([
      {
        kind: "missing_link",
        kcId: "kc-1",
        linkedKcId: "kc-2",
        chunkId: "ch-1",
        quote: "FOLLOWS from THE  **change**",
        reason: "Thrust builds on momentum.",
      },
    ]);
    const description = file({ kind: "wrong_description", linkedKcId: null });
    await expect(description.run).resolves.toEqual({ findingId: "f-1" });
    expect(description.saved).toMatchObject([{ linkedKcId: null }]);
  });

  test.each([
    [{ linkedKcId: null }, "give the prerequisite or semantic neighbour"],
    [{ kind: "wrong_link", linkedKcId: "" }, "give the prerequisite"],
    [{ kind: "wrong_description" }, "omit linkedKcId"],
    [{ linkedKcId: "kc-1" }, "two different KCs"],
    [{ kcId: "x-1" }, "no KC ids of this Course: x-1"],
    [{ linkedKcId: "x-2" }, "no KC ids of this Course: x-2"],
    [{ chunkId: "ch-9" }, "ch-9 is no chunk of this Course"],
    [{ quote: "change of momentum" }, "The quote is not in that chunk"],
  ])("refuses %o without saving", async (input, message) => {
    const { run, saved } = file(input);
    await expect(run).rejects.toThrow(message);
    expect(saved).toEqual([]);
  });

  test("takes a quote of at most 500 characters and a one-line reason", () => {
    const input = { kind: "wrong_link", kcId: "k", chunkId: "c" };
    const ok = (quote: string, reason = "Off.") =>
      accepts("flagMap", { ...input, quote, reason });
    expect(ok("x".repeat(500))).toBe(true);
    expect(ok("x".repeat(501))).toBe(false);
    expect(ok("")).toBe(false);
    expect(ok("x", "Two\nlines")).toBe(false);
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
      await grade(thrust, [
        { kcId: "kc-a", result: "partial" },
        { kcId: "kc-b", result: "wrong" },
      ]);
      expect(saved[0]?.check).toBeNull();
    });

    test("refuses a full without the final value", async () => {
      await expect(grade(thrust)).rejects.toThrow(
        "a full needs the Student's final value",
      );
      expect(saved).toEqual([]);
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
    expect(endsReply({ steps: [step("getTopic")] } as never)).toBe(false);
  });
});

describe("setStage", () => {
  const call = (actions: Partial<TutorToolActions>, input: object) =>
    tutorTools({ ...noActions, ...actions }).setStage.execute!(
      input as never,
      { toolCallId: "1", messages: [] } as never,
    );
  const at = (stage: "orient" | "close") => async () => ({
    stage,
    afterReview: "orient" as const,
    readingLeft: false,
  });

  test("saves an allowed move and returns the stage", async () => {
    const saved: string[] = [];
    const saveStage = async (stage: string) => saved.push(stage) > 0;
    expect(
      await call({ loadStage: at("orient"), saveStage }, { stage: "prime" }),
    ).toEqual({ stage: "prime" });
    expect(saved).toEqual(["prime"]);
  });

  test("refuses a session without a Topic, a skip without a reason and leaving close", async () => {
    await expect(call({}, { stage: "prime" })).rejects.toThrow("no Topic");
    await expect(
      call({ loadStage: at("orient") }, { stage: "apply" }),
    ).rejects.toThrow("give a one-line reason");
    await expect(
      call({ loadStage: at("close") }, { stage: "rebuild", reason: "More." }),
    ).rejects.toThrow("stays there");
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
