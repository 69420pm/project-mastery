import { describe, expect, test } from "vitest";
import { arrangeMap, courseLanguage } from "./course-order";

describe("arrangeMap", () => {
  test("orders KCs by their first source and names one Big idea per chapter", () => {
    const chunks = [
      { id: "c1", chapter: "Vectors" },
      { id: "c2", chapter: "Vectors" },
      { id: "c3", chapter: "Bases" },
    ];

    expect(
      arrangeMap(chunks, [
        { id: "basis", sources: ["c3"] },
        { id: "span", sources: ["c3", "c2"] },
        { id: "vector", sources: ["c1"] },
        { id: "gone", sources: ["c9"] },
      ]),
    ).toEqual({
      bigIdeas: ["Vectors", "Bases"],
      kcs: [
        { id: "vector", bigIdea: "Vectors" },
        { id: "span", bigIdea: "Vectors" },
        { id: "basis", bigIdea: "Bases" },
      ],
    });
  });
});

describe("courseLanguage", () => {
  test("is the most common language, the earlier on a tie, else English", () => {
    expect(courseLanguage(["en", null, "de", "de"])).toBe("de");
    expect(courseLanguage(["fr", "de"])).toBe("fr");
    expect(courseLanguage([null])).toBe("en");
  });
});
