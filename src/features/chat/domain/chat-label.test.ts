import { describe, expect, test } from "vitest";
import { chatLabel } from "./chat-label";

describe("chatLabel", () => {
  test("is the Chat's title when it has one", () => {
    expect(chatLabel({ title: "Eigenvalues", firstMessage: "What is…" })).toBe(
      "Eigenvalues",
    );
  });

  test("is the first message when the Chat has no title", () => {
    expect(chatLabel({ title: null, firstMessage: "Derive sin'(x)" })).toBe(
      "Derive sin'(x)",
    );
  });

  test("shortens a long first message at a word, with an ellipsis", () => {
    expect(
      chatLabel({
        title: null,
        firstMessage:
          "Can you explain why the determinant of a product equals the product of the determinants?",
      }),
    ).toBe("Can you explain why the determinant of a…");
  });

  test("puts a multi-line first message on one line", () => {
    expect(
      chatLabel({ title: null, firstMessage: "  Solve\n\n  x + 1 = 2  " }),
    ).toBe("Solve x + 1 = 2");
  });

  test("cuts a single long word", () => {
    expect(chatLabel({ title: null, firstMessage: "x".repeat(60) })).toBe(
      `${"x".repeat(40)}…`,
    );
  });

  test("falls back to New chat without a title or text", () => {
    expect(chatLabel({ title: null, firstMessage: null })).toBe("New chat");
    expect(chatLabel({ title: "  ", firstMessage: " " })).toBe("New chat");
  });
});
