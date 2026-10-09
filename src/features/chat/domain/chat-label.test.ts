import { describe, expect, test } from "vitest";
import type { ChatUIMessage } from "@/features/chat/types";
import { chatLabel } from "./chat-label";

/** A first message of only text. */
const said = (text: string): ChatUIMessage["parts"] => [{ type: "text", text }];

/** A Material attached to a message. */
const attached = (name: string): ChatUIMessage["parts"][number] => ({
  type: "data-material",
  data: {
    materialId: "00000000-0000-4000-8000-000000000001",
    name,
    mediaType: "application/pdf",
  },
});

describe("chatLabel", () => {
  test("is the Chat's title when it has one", () => {
    expect(
      chatLabel({ title: "Eigenvalues", firstMessage: said("What is…") }),
    ).toBe("Eigenvalues");
  });

  test("is the first message when the Chat has no title", () => {
    expect(
      chatLabel({ title: null, firstMessage: said("Derive sin'(x)") }),
    ).toBe("Derive sin'(x)");
  });

  test("shortens a long first message at a word, with an ellipsis", () => {
    expect(
      chatLabel({
        title: null,
        firstMessage: said(
          "Can you explain why the determinant of a product equals the product of the determinants?",
        ),
      }),
    ).toBe("Can you explain why the determinant of a…");
  });

  test("puts a multi-line first message on one line", () => {
    expect(
      chatLabel({
        title: null,
        firstMessage: said("  Solve\n\n  x + 1 = 2  "),
      }),
    ).toBe("Solve x + 1 = 2");
  });

  test("cuts a single long word", () => {
    expect(chatLabel({ title: null, firstMessage: said("x".repeat(60)) })).toBe(
      `${"x".repeat(40)}…`,
    );
  });

  test("falls back to New chat without a title or text", () => {
    expect(chatLabel({ title: null, firstMessage: null })).toBe("New chat");
    expect(chatLabel({ title: "  ", firstMessage: said(" ") })).toBe(
      "New chat",
    );
  });

  test("ignores attached Materials when the first message has text", () => {
    expect(
      chatLabel({
        title: null,
        firstMessage: [attached("Lecture 3"), ...said("Explain page 2")],
      }),
    ).toBe("Explain page 2");
  });

  test("is the first Material's name when the first message has only Materials", () => {
    expect(
      chatLabel({
        title: null,
        firstMessage: [attached("Lecture 3"), attached("Exercise sheet 4")],
      }),
    ).toBe("Lecture 3");
  });
});
