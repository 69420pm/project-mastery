import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SessionBar } from "./session-bar";

// The study feature's index also exports server actions.
vi.mock("server-only", () => ({}));
vi.mock("@/features/study", () => ({
  EndSessionButton: () => <button type="button">End session</button>,
  StageBar: () => null,
  MODE_LABELS: { learn: "Learn", review: "Review", practice: "Practice" },
}));

const bar = (mode: "learn" | "review" | "practice", canEnd = true) =>
  render(
    <SessionBar
      chatId="c1"
      stage={null}
      mode={mode}
      canEnd={canEnd}
      busy={false}
      onEnded={() => {}}
      onError={() => {}}
    />,
  );

test.each([
  ["review", "Review"],
  ["practice", "Practice"],
] as const)(
  "a %s session shows its mode next to End session",
  (mode, label) => {
    bar(mode);

    expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByRole("button", { name: "End session" })).toBeVisible();
  },
);

test("a learn session without stages shows no mode label", () => {
  bar("learn");

  expect(screen.queryByText("Learn")).toBeNull();
  expect(screen.getByRole("button", { name: "End session" })).toBeVisible();
});

test("shows a review session's progress after its mode", () => {
  render(
    <SessionBar
      chatId="c1"
      stage={null}
      mode="review"
      progress="3 of 5 done"
      canEnd
      busy={false}
      onEnded={() => {}}
      onError={() => {}}
    />,
  );

  expect(screen.getByText("Review · 3 of 5 done")).toBeVisible();
});

test("shows the mode before the session can be ended", () => {
  bar("review", false);

  expect(screen.getByText("Review")).toBeVisible();
  expect(screen.queryByRole("button", { name: "End session" })).toBeNull();
});
