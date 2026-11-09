import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ReadinessLine } from "./readiness-line";

const readiness = { course: 0.62, onTheDay: true };

describe("ReadinessLine", () => {
  test("shows the Readiness on the day, without a mock score before one is graded", () => {
    render(<ReadinessLine state={{ readiness, lastMockPercent: null }} />);
    const line = screen.getByText(/recall on the day: 62%/);
    expect(line.textContent).not.toContain("mock");
  });

  test("puts the latest mock score beside it, and says today without an exam ahead", () => {
    render(
      <ReadinessLine
        state={{
          readiness: { ...readiness, onTheDay: false },
          lastMockPercent: 55,
        }}
      />,
    );
    expect(screen.getByText(/recall today: 62%/).textContent).toContain(
      "Last mock: 55%",
    );
  });

  test("shows nothing without Priorities", () => {
    const { container } = render(
      <ReadinessLine
        state={{
          readiness: { ...readiness, course: null },
          lastMockPercent: 40,
        }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
