import { describe, expect, test } from "vitest";
import { cropRectangle } from "./figure-crop";

const page = { width: 1000, height: 2000 };

describe("cropRectangle", () => {
  test("turns a normalized box into a pixel rectangle with padding", () => {
    // 2% of the page's longer side (2000px) is 40px of padding on each side.
    expect(
      cropRectangle({ x: 0.2, y: 0.25, width: 0.5, height: 0.25 }, page),
    ).toEqual({ left: 160, top: 460, width: 580, height: 580 });
  });

  test("clamps the padded rectangle to the page", () => {
    expect(
      cropRectangle({ x: 0, y: 0.9, width: 1, height: 0.1 }, page),
    ).toEqual({ left: 0, top: 1760, width: 1000, height: 240 });
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
    expect(cropRectangle(box, page)).toBeNull();
  });
});
