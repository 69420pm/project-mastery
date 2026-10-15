import { describe, expect, it } from "vitest";
import {
  difficulty,
  exerciseFromAnswer,
  solutionStatus,
  withExerciseKcs,
  type ExerciseAnswer,
  type ProposedKc,
} from "@/features/knowledge-map/domain/exercises";
import type { KnowledgeMap } from "@/features/knowledge-map/schemas";

describe("withExerciseKcs", () => {
  const proposed = (name: string, bigIdea = "b1"): ProposedKc => ({
    name,
    description: `${name}.`,
    type: "procedure",
    bloom: "apply",
    bigIdea,
  });
  const map: KnowledgeMap = {
    bigIdeas: [{ id: "b1", name: "Thrust", description: "Thrust." }],
    kcs: [
      {
        id: "k1",
        name: "Thrust equation",
        description: "F",
        type: "concept",
        bloom: "apply",
        bigIdea: "b1",
        origin: "content",
        sources: ["c1"],
      },
    ],
    prerequisites: [],
    semanticLinks: [],
    exercises: [],
    findings: [],
  };

  it("adds a KC several subtasks propose once, from their exercises", () => {
    const merged = withExerciseKcs(map, [
      {
        questionChunkId: "q1",
        newKcs: [proposed("Propulsive power", "unknown"), proposed("Lone")],
      },
      { questionChunkId: "q2", newKcs: [proposed(" propulsive POWER ")] },
      { questionChunkId: "q3", newKcs: [proposed("thrust equation")] },
    ]);
    expect(merged.addedKcIds).toEqual(["x1"]);
    expect(merged.map.kcs.at(-1)).toEqual({
      id: "x1",
      name: "Propulsive power",
      description: "Propulsive power.",
      type: "procedure",
      bloom: "apply",
      bigIdea: "b1",
      origin: "exercise",
      sources: ["q1", "q2"],
    });
    // One proposal of a lone name goes; an existing name is that KC.
    expect(merged.map.kcs).toHaveLength(2);
    expect(merged.kcIds).toEqual([["x1"], ["x1"], ["k1"]]);
  });
});

describe("difficulty", () => {
  it.each([
    [{ kcCount: 2, blooms: ["apply" as const, null], steps: 2 }, 1],
    [{ kcCount: 3, blooms: ["apply" as const], steps: 2 }, 2],
    [{ kcCount: 2, blooms: ["apply" as const], steps: 3 }, 2],
    [{ kcCount: 1, blooms: ["evaluate" as const], steps: 1 }, 3],
    [{ kcCount: 4, blooms: ["remember" as const], steps: 1 }, 3],
    [{ kcCount: 1, blooms: ["remember" as const], steps: 5 }, 3],
  ])("rates %o as %i", (input, expected) => {
    expect(difficulty(input)).toBe(expected);
  });
});

describe("solutionStatus", () => {
  it("verifies a matching solution, disputes another and generates a missing one", () => {
    expect(solutionStatus({ finalResult: "28 kN", matches: true })).toBe(
      "verified",
    );
    expect(solutionStatus({ finalResult: "46.5%", matches: false })).toBe(
      "disputed",
    );
    expect(solutionStatus(null)).toBe("generated");
  });
});

describe("exerciseFromAnswer", () => {
  const subtask = {
    id: "e1",
    name: "Ex. 7.1",
    questionChunkId: "q",
    solutionChunkId: "s",
  };
  const answer: ExerciseAnswer = {
    kcIds: ["k1", "unknown", "k1"],
    newKcs: [],
    taskType: " compute efficiency ",
    solution: "η = 1 − 12^−0.2857",
    finalResult: "50.8%",
    steps: 2,
    given: { finalResult: "46.5%", matches: false },
  };
  const map = {
    kcs: [
      {
        id: "k1",
        name: "Thermal efficiency",
        description: "η",
        type: "procedure" as const,
        bloom: "apply" as const,
        bigIdea: "b1",
        origin: "content" as const,
        sources: [],
      },
    ],
  };

  it("drops unknown KCs and records a disputed solution as a finding", () => {
    expect(exerciseFromAnswer(subtask, answer, map)).toEqual({
      exercise: {
        id: "e1",
        name: "Ex. 7.1",
        questionChunk: "q",
        taskType: "compute efficiency",
        solutionStatus: "disputed",
        solution: null,
        difficulty: 1,
        kcs: ["k1"],
      },
      finding: {
        kind: "solution_mismatch",
        text: "Ex. 7.1: the given answer is 46.5%, our calculation gives 50.8%.",
        sources: ["q", "s"],
      },
    });
  });

  it("stores the build's own solution when none was given", () => {
    const { exercise, finding } = exerciseFromAnswer(
      { ...subtask, solutionChunkId: null },
      { ...answer, given: null },
      map,
    );
    expect(exercise).toMatchObject({
      solutionStatus: "generated",
      solution: "η = 1 − 12^−0.2857",
    });
    expect(finding).toBeNull();
  });
});
