import { describe, expect, test } from "vitest";
import { materialNameFromFilename } from "./material-name";

describe("materialNameFromFilename", () => {
  test.each([
    ["Lecture 3.pdf", "Lecture 3"],
    ["exam.2024.solutions.PNG", "exam.2024.solutions"],
    ["  Whiteboard photo .jpeg ", "Whiteboard photo"],
    ["notes", "notes"],
    [".pdf", ".pdf"],
    ["slides.", "slides"],
  ])("names %j %j", (filename, name) => {
    expect(materialNameFromFilename(filename)).toBe(name);
  });

  test("keeps the first 200 characters of a long name", () => {
    const name = materialNameFromFilename(`${"x".repeat(250)}.pdf`);

    expect(name).toBe("x".repeat(200));
  });

  test("falls back to a placeholder when nothing is left", () => {
    expect(materialNameFromFilename("   ")).toBe("Untitled");
  });
});
