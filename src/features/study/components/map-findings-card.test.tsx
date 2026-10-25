import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { MapFindingItem } from "@/features/study/types";

const answerMapFinding = vi.fn();
vi.mock("@/features/study/server/actions", () => ({
  answerMapFinding: (...args: unknown[]) => answerMapFinding(...args),
}));

const { MapFindingsCard } = await import("./map-findings-card");

const open: MapFindingItem = {
  id: "f1",
  kind: "wrong_link",
  status: "open",
  kc: "Thrust",
  linkedKc: "Drag",
  reason: "The lecture derives thrust without drag.",
  quote: "Thrust follows from momentum alone.",
  source: { label: "Lecture 1, p. 3", link: "/courses/c1/materials/m1#c" },
};

const accepted: MapFindingItem = {
  ...open,
  id: "f2",
  kind: "wrong_description",
  status: "accepted",
  linkedKc: null,
  reason: "The description names the wrong unit.",
};

beforeEach(() => {
  answerMapFinding.mockReset().mockResolvedValue({ ok: true, data: undefined });
});

test("is hidden without Findings", () => {
  const { container } = render(<MapFindingsCard findings={[]} />);
  expect(container).toBeEmptyDOMElement();
});

test("lists Findings with their quote's page, and answers an open one", async () => {
  render(<MapFindingsCard findings={[open, accepted]} />);

  const [first] = screen.getAllByRole("listitem");
  expect(first).toHaveTextContent("Wrong link: Thrust and Drag");
  expect(screen.getByText(open.reason)).toBeInTheDocument();
  expect(
    screen.getAllByRole("link", { name: "Lecture 1, p. 3" })[0],
  ).toHaveAttribute("href", "/courses/c1/materials/m1#c");
  expect(
    screen.getByText("Accepted: applied at the next Update map."),
  ).toBeInTheDocument();
  // Only the open Finding can be answered.
  expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(1);

  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  await waitFor(() =>
    expect(answerMapFinding).toHaveBeenCalledWith("f1", "dismissed"),
  );
});

test("shows why an answer failed", async () => {
  answerMapFinding.mockResolvedValue({ ok: false, message: "Sign in again." });
  render(<MapFindingsCard findings={[open]} />);
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again.");
});
