import { describe, expect, test } from "vitest";
import {
  checkExerciseAnswer,
  exerciseDifficulty,
  needsExerciseExtraction,
} from "./exercise-extraction";

describe("exerciseDifficulty", () => {
  test.each([
    [3, null, 3],
    [1, 12, 3],
    [1, 4, 1],
    [1, null, 1],
    [1, 5, 2],
    [2, null, 2],
  ] as const)("%i KCs and %s solution lines give %i", (kcs, lines, level) => {
    expect(exerciseDifficulty(kcs, lines)).toBe(level);
  });
});

describe("checkExerciseAnswer", () => {
  const subtasks = [
    { id: "s1", chunkId: "c1", solutionChunkId: "c9", solution: "a\n\nb" },
    { id: "s2", chunkId: "c2", solutionChunkId: null, solution: null },
  ];
  const kcIdOf = new Map([
    ["k1", "kc-1"],
    ["k2", "kc-2"],
  ]);

  test("drops unknown ids and unreadable keys, shares a new KC named twice and keeps unanswered subtasks", () => {
    const rank = {
      name: "Rank",
      description: "The rank.",
    };
    const checked = checkExerciseAnswer(
      {
        subtasks: [
          {
            id: "s1",
            notAnExercise: false,
            kcIds: ["k2", "k7", "k2"],
            newKcs: [rank, { ...rank, name: " rank" }],
            finalAnswers: [
              { label: " x ", value: " [[1, 2], [0, 1]] ", anyOrder: false },
              { label: "y", value: "8 kN)", anyOrder: false },
            ],
          },
        ],
      },
      [...subtasks, { ...subtasks[1]!, id: "s3", chunkId: "c3" }],
      kcIdOf,
    );
    expect(checked.exercises[0]).toEqual({
      chunkId: "c1",
      solutionChunkId: "c9",
      notAnExercise: false,
      kcIds: ["kc-2"],
      newKcs: [0],
      finalAnswers: [
        { label: "x", value: "[[1, 2], [0, 1]]", anyOrder: false },
      ],
      solutionLines: 2,
    });
    expect(checked.exercises[1]).toMatchObject({ kcIds: [], newKcs: [] });
    expect(checked.kcs).toEqual([{ ...rank, chunkIds: ["c1"], assumes: [] }]);
  });

  test("counts a new KC named by an offered id as that KC", () => {
    const checked = checkExerciseAnswer(
      {
        subtasks: [
          {
            id: "s1",
            notAnExercise: false,
            kcIds: ["k2"],
            newKcs: [
              { name: " k1", description: "The first one." },
              { name: "k2", description: "Again." },
            ],
            finalAnswers: [],
          },
        ],
      },
      subtasks.slice(0, 1),
      kcIdOf,
    );
    expect(checked.exercises[0]).toMatchObject({
      kcIds: ["kc-2", "kc-1"],
      newKcs: [],
    });
    expect(checked.kcs).toEqual([]);
  });
});

describe("needsExerciseExtraction", () => {
  const exercise = {
    chunkId: "c1",
    solutionChunkId: null,
    notAnExercise: false,
    kcIds: [],
    newKcs: [],
    finalAnswers: [],
    solutionLines: null,
  };
  const part = { contentHash: "h", exerciseChunkIds: ["c1"] };
  const stored = { contentHash: "h", exercises: [exercise] };

  test("calls again only for new content or a changed pair", () => {
    expect(needsExerciseExtraction(stored, part, () => null)).toBe(false);
    expect(needsExerciseExtraction(undefined, part, () => null)).toBe(true);
    expect(
      needsExerciseExtraction(
        { ...stored, contentHash: "g" },
        part,
        () => null,
      ),
    ).toBe(true);
    expect(needsExerciseExtraction(stored, part, () => "c9")).toBe(true);
  });
});
