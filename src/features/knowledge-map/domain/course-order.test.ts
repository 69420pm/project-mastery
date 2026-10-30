import { describe, expect, test } from "vitest";
import { courseLanguage } from "./course-order";

describe("courseLanguage", () => {
  test("is the most common language, the earlier on a tie, else English", () => {
    expect(courseLanguage(["en", null, "de", "de"])).toBe("de");
    expect(courseLanguage(["fr", "de"])).toBe("fr");
    expect(courseLanguage([null])).toBe("en");
  });
});
