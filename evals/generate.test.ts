// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { loadFixture } from "./eval";
import {
  callInput,
  generateEval,
  generateGate,
  scoreGenerate,
  type GenerateRecord,
} from "./generate";

vi.mock("server-only", () => ({}));

const record = (changes: Partial<GenerateRecord>): GenerateRecord => ({
  kind: "new",
  schemaValid: true,
  firstTry: true,
  stored: true,
  error: null,
  errors: [],
  calls: 1,
  costUsd: 0.001,
  program: "a = 1",
  statement: "s",
  solution: "s",
  finalAnswers: null,
  ...changes,
});

describe("the generate dataset", () => {
  it("has 10 variants and 10 new Problems whose call inputs resolve", async () => {
    const { items } = await loadFixture(generateEval);
    const inputs = await Promise.all(items.map((i) => callInput(i.input)));
    expect(inputs.filter((i) => i.kind === "variant")).toHaveLength(10);
    expect(inputs.filter((i) => i.kind === "new")).toHaveLength(10);
    for (const input of inputs) {
      if (input.kind === "variant") {
        expect(input.exercise.question).not.toBe("");
      } else {
        expect(input.kcs.every((kc) => kc.sources.length > 0)).toBe(true);
        expect(input.styleAnchors.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("scoreGenerate and generateGate", () => {
  const gate = (records: GenerateRecord[]) =>
    generateGate(records.map((r) => ({ evaluations: scoreGenerate(r) })));

  it("fails the gate when a program still fails after the retry", () => {
    const failed = record({
      firstTry: false,
      stored: false,
      error: "Program: Undefined symbol x",
      errors: ["Program: Undefined symbol x", "Program: Undefined symbol x"],
    });
    expect(gate([record({}), failed]).passed).toBe(false);
  });

  it("fails the gate when the program failed and the retry failed the schema", () => {
    const schema =
      "The answer was no valid JSON object of the requested shape.";
    const failed = record({
      firstTry: false,
      stored: false,
      error: schema,
      errors: ["Program: Undefined symbol x", schema],
    });
    expect(gate([failed]).passed).toBe(false);
  });

  it("passes when a failed draft was fixed by the retry, and prices a stored Problem", () => {
    const fixed = record({
      firstTry: false,
      errors: ["Program: Undefined symbol x"],
      calls: 2,
      costUsd: 0.003,
    });
    const { passed, summary } = gate([record({}), fixed]);
    expect(passed).toBe(true);
    expect(summary).toContain("first try 1");
    expect(summary).toContain("$0.00200 per stored Problem");
  });

  it("does not fail the gate on a placeholder or schema failure", () => {
    const bad = record({
      schemaValid: false,
      firstTry: false,
      stored: false,
      error: "Statement: unresolved {{x}}",
      errors: ["Statement: unresolved {{x}}"],
    });
    expect(gate([bad]).passed).toBe(true);
  });
});
