import { describe, expect, test } from "vitest";
import { usableBox } from "./figure-box";

describe("usableBox", () => {
  test("pads the box on every side", () => {
    const box = usableBox({ x: 0.2, y: 0.25, width: 0.5, height: 0.25 });
    expect(box).toEqual({
      x: expect.closeTo(0.18),
      y: expect.closeTo(0.23),
      width: expect.closeTo(0.54),
      height: expect.closeTo(0.29),
    });
  });

  test("clamps the padded box to the page", () => {
    const box = usableBox({ x: 0, y: 0.9, width: 1, height: 0.1 });
    expect(box).toEqual({
      x: 0,
      y: expect.closeTo(0.88),
      width: 1,
      height: expect.closeTo(0.12),
    });
  });

  test("widens a narrow box around its center", () => {
    const box = usableBox({ x: 0.4, y: 0.4, width: 0.1, height: 0.3 });
    expect(box).toEqual({
      x: expect.closeTo(0.325),
      y: expect.closeTo(0.38),
      width: 0.25,
      height: expect.closeTo(0.34),
    });
  });

  test("keeps a widened box on the page", () => {
    expect(usableBox({ x: 0.92, y: 0.1, width: 0.08, height: 0.1 })).toEqual(
      expect.objectContaining({ x: 0.75, width: 0.25 }),
    );
  });

  test.each([
    ["missing", null],
    ["empty", { x: 0.2, y: 0.2, width: 0, height: 0.3 }],
    ["inverted", { x: 0.2, y: 0.2, width: -0.3, height: 0.3 }],
    ["left of the page", { x: -0.2, y: 0.2, width: 0.3, height: 0.3 }],
    ["right of the page", { x: 0.8, y: 0.2, width: 0.5, height: 0.3 }],
    ["below the page", { x: 0.2, y: 0.9, width: 0.3, height: 0.3 }],
    ["not a number", { x: Number.NaN, y: 0.2, width: 0.3, height: 0.3 }],
    [
      "in pixels instead of fractions",
      { x: 120, y: 300, width: 400, height: 200 },
    ],
  ])("is null for a %s box, meaning the whole page", (_, box) => {
    expect(usableBox(box)).toBeNull();
  });
});
