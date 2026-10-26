import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ReadinessLine } from "./readiness-line";

const base = { course: 0.62, topics: {}, mocks: 0, onTheDay: true };

describe("ReadinessLine", () => {
  test("is untested until a mock is graded", () => {
    render(<ReadinessLine readiness={base} />);
    expect(screen.getByText(/recall on the day: 62%/).textContent).toContain(
      "untested",
    );
  });

  test("names the mocks that check it, and says today without an exam ahead", () => {
    render(
      <ReadinessLine readiness={{ ...base, mocks: 2, onTheDay: false }} />,
    );
    const line = screen.getByText(/recall today: 62%/);
    expect(line.textContent).toContain("checked against 2 mocks");
  });

  test("shows nothing without Priorities", () => {
    const { container } = render(
      <ReadinessLine readiness={{ ...base, course: null }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
