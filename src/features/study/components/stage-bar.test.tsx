import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { StageBar } from "./stage-bar";

test("shows the eight stages with the current one marked and the earlier ones done", () => {
  render(<StageBar stage="read" />);

  const stages = screen.getAllByRole("listitem");
  expect(stages.map((li) => li.textContent)).toEqual([
    "Review (done)",
    "Orient (done)",
    "Prime (done)",
    "Read",
    "Work",
    "Apply",
    "Rebuild",
    "Close",
  ]);
  expect(screen.getByText("Read").closest("li")).toHaveAttribute(
    "aria-current",
    "step",
  );
  // Below lg, only the current stage shows.
  expect(stages.filter((li) => li.classList.contains("hidden"))).toHaveLength(
    7,
  );
});
