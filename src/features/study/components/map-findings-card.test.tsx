import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { MapFindingItem } from "@/features/study/types";

const answerMapFinding = vi.fn();
vi.mock("@/features/study/server/actions", () => ({
  answerMapFinding: (...args: unknown[]) => answerMapFinding(...args),
}));

const { MapFindingsCard } = await import("./map-findings-card");

const link: MapFindingItem = {
  id: "f1",
  kind: "wrong_link",
  kc: "Thrust",
  linkedKc: "Drag",
  proposedDescription: null,
  reason: "The lecture derives thrust without drag.",
  quote: "Thrust follows from momentum alone.",
  source: { label: "Lecture 1, p. 3", link: "/courses/c1/materials/m1#c" },
};

const description: MapFindingItem = {
  ...link,
  id: "f2",
  kind: "wrong_description",
  linkedKc: null,
  proposedDescription: "Thrust is the force a jet exerts.",
  reason: "The description names the wrong unit.",
};

beforeEach(() => {
  answerMapFinding.mockReset().mockResolvedValue({ ok: true, data: undefined });
});

test("is hidden without Findings", () => {
  const { container } = render(<MapFindingsCard findings={[]} />);
  expect(container).toBeEmptyDOMElement();
});

test("lists Findings with their quote's page and proposed description, and dismisses one", async () => {
  render(<MapFindingsCard findings={[link, description]} />);

  const [first] = screen.getAllByRole("listitem");
  expect(first).toHaveTextContent("Wrong link: Thrust builds on Drag");
  expect(screen.getByText(link.reason)).toBeInTheDocument();
  expect(
    screen.getAllByRole("link", { name: "Lecture 1, p. 3" })[0],
  ).toHaveAttribute("href", "/courses/c1/materials/m1#c");
  expect(
    screen.getByText("New description: Thrust is the force a jet exerts."),
  ).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(2);

  fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]!);
  await waitFor(() =>
    expect(answerMapFinding).toHaveBeenCalledWith("f1", "dismissed"),
  );
});

test("shows why an accept was refused", async () => {
  answerMapFinding.mockResolvedValue({
    ok: false,
    message: "This link would make a cycle.",
  });
  render(<MapFindingsCard findings={[link]} />);
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This link would make a cycle.",
  );
});
