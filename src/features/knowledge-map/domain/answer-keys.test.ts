import { describe, expect, it } from "vitest";
import {
  checkAnswer,
  checkAnswers,
  checkEachAnswer,
  isReadableAnswer,
  UnreadableAnswerError,
  worstCheck,
  type AnswerKey,
} from "./answer-keys";

const key = (value: string, anyOrder = false): AnswerKey => ({
  label: "Result",
  value,
  anyOrder,
});

describe("checkAnswer", () => {
  it.each([
    // Numbers, at 1% of the key
    ["0.508", "0.51", "match"],
    ["0.508", "0.6", "mismatch"],
    ["1/2", "0.5", "match"],
    // Zero, within 1e-9
    ["0", "0", "match"],
    ["0", "1e-12", "match"],
    ["0", "0.001", "mismatch"],
    // Units, in the key's unit with the same base
    ["12 kg*m/s^2", "12 N", "match"],
    ["17.5 kN", "17500 N", "match"],
    ["17.5 kN", "17.5", "mismatch"],
    ["17.5 kN", "17.5 m", "mismatch"],
    ["300 degC", "573.15 K", "match"],
    // Complex numbers
    ["3+4i", "3 + 4i", "match"],
    ["3+4i", "3 - 4i", "mismatch"],
    // Vectors and matrices, same size, element by element
    ["[[1,2],[0,1]]", "[[1, 2], [0, 1]]", "match"],
    ["[[1,2],[0,1]]", "[[1, 2], [1, 0]]", "mismatch"],
    ["[[1,2],[0,1]]", "[1, 2]", "mismatch"],
    ["[2,-3]", "[[2], [-3]]", "match"],
    ["[2,-3]", "[-3, 2]", "mismatch"],
    ["[0, 0]", "[0, 0]", "match"],
    ["[1, 2]", "3", "mismatch"],
    // Expressions with free symbols, at fixed points
    ["n+1", "1 + n", "match"],
    ["n+1", "n + 2", "mismatch"],
    ["t^2 + 1", "1 + t*t", "match"],
    ["e^x", "exp(x)", "match"],
    ["(x+1)^2", "x^2 + 2x + 1", "match"],
    ["x", "5", "mismatch"],
    // An assignment is read as its value
    ["5", "x = 5", "match"],
    // Anything else is unchecked
    ["true", "true", "unchecked"],
    ['"yes"', '"yes"', "unchecked"],
    ["1 / (x - x)", "1 / (x - x)", "unchecked"],
  ] as const)("key %s, value %s: %s", (expected, given, result) => {
    expect(checkAnswer(key(expected), given)).toBe(result);
  });

  it("compares anyOrder lists as multisets", () => {
    expect(checkAnswer(key("[2, -3, 2]", true), "[-3, 2, 2]")).toBe("match");
    expect(checkAnswer(key("[2, -3, 2]", true), "[-3, -3, 2]")).toBe(
      "mismatch",
    );
  });

  it("throws for a value mathjs cannot parse, and refuses functions that allocate", () => {
    expect(() => checkAnswer(key("1"), "17.5 kN)")).toThrow(
      UnreadableAnswerError,
    );
    expect(checkAnswer(key("[1, 2]"), "range(1, 1e9)")).toBe("unchecked");
    expect(checkAnswer(key("[1, 2]"), "1:1e9")).toBe("unchecked");
    expect(isReadableAnswer("[[1,2],[0,1]]")).toBe(true);
    expect(isReadableAnswer("x = = 1")).toBe(false);
  });
});

describe("checkAnswers", () => {
  const keys = [
    { label: "Thrust", value: "17.5 kN", anyOrder: false },
    { label: "Speed", value: "350 m/s", anyOrder: false },
  ];

  it("checks each key by its label, null for a key without a value", () => {
    expect(
      checkAnswers(keys, [{ label: "thrust ", value: "17.5 kN" }]),
    ).toEqual({ ok: true, checks: ["match", null] });
    expect(worstCheck(["match", null])).toBe("unchecked");
    expect(worstCheck(["unchecked", "mismatch"])).toBe("mismatch");
    expect(worstCheck(["match"])).toBe("match");
    expect(worstCheck([])).toBeNull();
  });

  it("takes an unlabelled value for a single key", () => {
    expect(checkAnswers(keys.slice(0, 1), [{ value: "17 kN" }])).toEqual({
      ok: true,
      checks: ["mismatch"],
    });
  });

  it("names unknown labels, repeated keys and unreadable values", () => {
    const failed = (given: Parameters<typeof checkAnswers>[1]) => {
      const result = checkAnswers(keys, given);
      return result.ok ? null : result.error;
    };
    expect(failed([{ label: "Mass", value: "1" }])).toContain("Thrust, Speed");
    expect(
      failed([
        { label: "Speed", value: "1 m/s" },
        { label: "speed", value: "2 m/s" },
      ]),
    ).toContain('"Speed"');
    expect(failed([{ label: "Speed", value: "(" }])).toContain("mathjs");
  });
});

describe("checkEachAnswer", () => {
  const keys = [
    { label: "Thrust", value: "17.5 kN", anyOrder: false },
    { label: "Speed", value: "350 m/s", anyOrder: false },
  ];

  it("checks each key on its own: an unreadable value hides no mismatch", () => {
    const checks = checkEachAnswer(keys, [
      { label: "Thrust", value: "(" },
      { label: "Speed", value: "200 m/s" },
    ]);
    expect(checks).toEqual(["unchecked", "mismatch"]);
    expect(worstCheck(checks)).toBe("mismatch");
  });

  it("leaves out unknown labels and second values", () => {
    expect(
      checkEachAnswer(keys, [
        { label: "Mass", value: "1 kg" },
        { label: "Speed", value: "350 m/s" },
        { label: "speed", value: "1 m/s" },
      ]),
    ).toEqual([null, "match"]);
  });
});
