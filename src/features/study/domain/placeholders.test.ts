import { expect, test } from "vitest";
import { fillPlaceholders } from "./placeholders";

const values = {
  efficiency: { value: 0.508_337, unit: null },
  thrust: { value: 17_500, unit: "N" },
  matrix: { value: null, unit: null },
};

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
