import { describe, expect, test } from "vitest";
import { checkAnnotations, checkStudyText } from "./reading-checks";

const range = { pageFrom: 3, pageTo: 5 };

describe("checkAnnotations", () => {
  test("passes notes on the section's pages", () => {
    expect(() =>
      checkAnnotations(
        [
          { page: 3, note: "a" },
          { page: 5, note: "b" },
        ],
        range,
      ),
    ).not.toThrow();
  });

  test("throws for a note outside the pages, or for none", () => {
    expect(() => checkAnnotations([{ page: 6, note: "a" }], range)).toThrow(
      "Notes on p. 6 are outside pp. 3–5.",
    );
    expect(() => checkAnnotations([], range)).toThrow();
  });
});

describe("checkStudyText", () => {
  test("passes cited paragraphs, headings, display math and the beyond-the-course note", () => {
    const text = [
      "## Thrust",
      "Thrust is $F = \\dot m (V_e - V_0)$. [p. 3]",
      "$$F = \\dot m V_e$$",
      "- Momentum in\n- Momentum out [pp. 4–5].",
      "> **Beyond the course:** rockets carry their oxidiser.",
      "The engine pushes air back. [pp. 3-4]",
    ].join("\n\n");
    expect(() => checkStudyText(text, range)).not.toThrow();
  });

  test("throws for a paragraph without a closing citation", () => {
    expect(() =>
      checkStudyText("Cited. [p. 3]\n\nNot cited [p. 3] here.", range),
    ).toThrow("1 paragraph(s) end without a citation");
  });

  test("throws for a citation outside the pages, anywhere in the text", () => {
    expect(() => checkStudyText("Out. [p. 6]", range)).toThrow(
      "[p. 6] is outside pp. 3–5.",
    );
    expect(() => checkStudyText("See [p. 2], in. [p. 3]", range)).toThrow(
      "[p. 2]",
    );
    expect(() => checkStudyText("Reversed. [pp. 5–3]", range)).toThrow();
  });

  test("throws for an empty text", () => {
    expect(() => checkStudyText(" \n\n ", range)).toThrow();
  });
});
