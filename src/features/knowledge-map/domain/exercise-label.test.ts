import { expect, test } from "vitest";
import { exerciseLabel } from "./exercise-label";

test("an Exercise is labelled by its Chapter and where it is printed", () => {
  expect(
    exerciseLabel({
      chapterTitle: "8.3 Vector spaces",
      materialName: "Exercises",
      pageFrom: 3,
    }),
  ).toBe("8.3 Vector spaces · Exercises p. 3");
  expect(
    exerciseLabel({ chapterTitle: null, materialName: "Sheet 7", pageFrom: 1 }),
  ).toBe("Sheet 7 p. 1");
});
