import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const PROBLEM = "aaaaaaaa-f000-4000-8000-000000000001";

const flagProblem = vi.fn();
vi.mock("@/features/study/server/actions", () => ({
  flagProblem: (...args: unknown[]) => flagProblem(...args),
}));

const { ProblemFlagControl } = await import("./problem-flag-control");

beforeEach(() => {
  flagProblem.mockReset().mockResolvedValue({ ok: true, data: undefined });
});

test("flags the Problem with one of four reasons, once", async () => {
  render(<ProblemFlagControl problemId={PROBLEM} flag={undefined} />);
  fireEvent.click(screen.getByRole("button", { name: "Flag this problem" }));
  const reasons = screen.getByRole("group", { name: "Why flag this problem?" });
  expect(
    [...reasons.querySelectorAll("button")].map((b) => b.textContent),
  ).toEqual(["Unclear", "Wrong", "Too easy", "Off topic", "Cancel"]);

  fireEvent.click(screen.getByRole("button", { name: "Too easy" }));

  expect(
    await screen.findByText(/Flagged as too easy: it won.t be asked again/),
  ).toBeVisible();
  expect(flagProblem).toHaveBeenCalledWith({
    problemId: PROBLEM,
    flag: "too_easy",
  });
  expect(screen.queryByRole("button")).toBeNull();
});

test("shows a stored flag without the control", () => {
  render(<ProblemFlagControl problemId={PROBLEM} flag="wrong" />);
  expect(screen.getByText(/Flagged as wrong/)).toBeVisible();
  expect(screen.queryByRole("button")).toBeNull();
});

test("says why a flag was refused", async () => {
  flagProblem.mockResolvedValue({
    ok: false,
    message: "This problem was flagged already.",
  });
  render(<ProblemFlagControl problemId={PROBLEM} flag={undefined} />);
  fireEvent.click(screen.getByRole("button", { name: "Flag this problem" }));
  fireEvent.click(screen.getByRole("button", { name: "Wrong" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This problem was flagged already.",
  );
});
