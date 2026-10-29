import { describe, expect, test } from "vitest";
import { languageTag, mostCommonLanguage, overlayPages } from "./pages";

describe("overlayPages", () => {
  test("skips a slide whose text starts the next slide's, whatever the line breaks", () => {
    expect(
      overlayPages([
        "Vectors",
        "Vectors\nadd up.",
        "Vectors add up.\nThey scale.",
        "Matrices",
      ]),
    ).toEqual([1, 2]);
  });

  test("never skips a page without text or the last page", () => {
    expect(overlayPages(["", "Figure", "Figure"])).toEqual([2]);
  });
});

describe("languageTag", () => {
  test("keeps a BCP 47 tag and drops anything else", () => {
    expect(languageTag(" de ")).toBe("de");
    expect(languageTag("en-GB")).toBe("en-GB");
    expect(languageTag("German")).toBeNull();
    expect(languageTag("")).toBeNull();
  });
});

describe("mostCommonLanguage", () => {
  test("is the language of most read pages, the earliest on a tie", () => {
    expect(mostCommonLanguage(["en", null, "de", "de"])).toBe("de");
    expect(mostCommonLanguage(["en", "de"])).toBe("en");
    expect(mostCommonLanguage([null])).toBeNull();
  });
});
