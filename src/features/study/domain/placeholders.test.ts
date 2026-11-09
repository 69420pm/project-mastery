import { expect, test } from "vitest";
import { fillPlaceholders } from "./placeholders";

const values = {
  efficiency: { value: 0.508_337, unit: null },
  thrust: { value: 17_500, unit: "N" },
  matrix: { value: null, unit: null },
  rotation: { value: null, unit: null, text: "[[0.70710678, -1], [1, 0]]" },
  root: { value: null, unit: null, text: "1.23456 + 2i" },
  flag: { value: null, unit: null, text: "true" },
};

test("fills a matrix or complex number at 4 significant figures", () => {
  expect(fillPlaceholders("{{rotation}}, {{root}}", values)).toEqual({
    ok: true,
    text: "[[0.7071, -1], [1, 0]], 1.235 + 2i",
  });
  expect(fillPlaceholders("{{flag}}", values)).toMatchObject({ ok: false });
});

test("fills each placeholder at 4 significant figures with its unit, LaTeX braces left alone", () => {
  expect(
    fillPlaceholders(
      "$\\frac{F}{\\sqrt{2}}$ with {{thrust}} and {{ efficiency }}.",
      values,
    ),
  ).toEqual({
    ok: true,
    text: "$\\frac{F}{\\sqrt{2}}$ with 17500 N and 0.5083.",
  });
});

test("an unknown, non-numeric or malformed placeholder is an error", () => {
  expect(fillPlaceholders("{{speed}} and {{matrix}}", values)).toMatchObject({
    ok: false,
    error: expect.stringContaining("{{speed}}, {{matrix}}"),
  });
  expect(fillPlaceholders("{{thrust}", values)).toMatchObject({ ok: false });
});
