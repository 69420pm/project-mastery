import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Markdown } from "./markdown";

describe("Markdown", () => {
  test("renders inline LaTeX with KaTeX", () => {
    const { container } = render(
      <Markdown>{"The area is $A = \\pi r^2$ for a circle."}</Markdown>,
    );

    const math = container.querySelector(".katex");
    expect(math).not.toBeNull();
    expect(math?.closest(".katex-display")).toBeNull();
    expect(container.querySelector("annotation")?.textContent).toBe(
      "A = \\pi r^2",
    );
  });

  test("renders block LaTeX in display mode", () => {
    const { container } = render(
      <Markdown>{"Euler:\n\n$$\ne^{i\\pi} + 1 = 0\n$$\n"}</Markdown>,
    );

    expect(container.querySelector(".katex-display .katex")).not.toBeNull();
    expect(container.querySelector("annotation")?.textContent).toBe(
      "e^{i\\pi} + 1 = 0",
    );
  });

  test("renders an unterminated block while streaming", () => {
    const { container } = render(
      <Markdown streaming>{"**Step 1:** solve\n\n$$\nx^2 = 4"}</Markdown>,
    );

    // While streaming, words are split into spans for the fade-in animation.
    expect(
      container.querySelector('[data-streamdown="strong"]'),
    ).toHaveTextContent("Step 1:");
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });
});
