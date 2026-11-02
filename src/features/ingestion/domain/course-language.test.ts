import { describe, expect, test } from "vitest";
import { courseLanguage } from "./course-language";

describe("courseLanguage", () => {
  test("is the most common language, the earlier on a tie, else English", () => {
    expect(courseLanguage(["English", null, "German", "German"])).toBe(
      "German",
    );
    expect(courseLanguage(["French", "German"])).toBe("French");
    expect(courseLanguage([null])).toBe("English");
  });
});
