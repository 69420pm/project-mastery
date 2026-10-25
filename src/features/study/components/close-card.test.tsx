import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { SessionSummary } from "@/features/study/types";

const CHAT = "aaaaaaaa-0000-4000-8000-000000000001";

const getSessionSummary = vi.fn();
const rateStudySession = vi.fn();
vi.mock("@/features/study/server/actions", () => ({
  getSessionSummary: (...args: unknown[]) => getSessionSummary(...args),
  rateStudySession: (...args: unknown[]) => rateStudySession(...args),
}));

const { CloseCard } = await import("./close-card");

const summary: SessionSummary = {
  topic: { name: "Thrust basics", state: "in_progress", recall: 0.5 },
  kcs: [
    {
      id: "k1",
      name: "Thrust equation",
      state: "learning",
      nextReview: "2026-10-27",
    },
    { id: "k2", name: "Mass flow", state: "new", nextReview: null },
  ],
  ended: false,
  rating: null,
  ratingNote: null,
};

const onRated = vi.fn();

beforeEach(() => {
  getSessionSummary.mockReset().mockResolvedValue({ ok: true, data: summary });
  rateStudySession.mockReset().mockResolvedValue({ ok: true, data: undefined });
  onRated.mockReset();
});

function renderCard(busy = false) {
  return render(
    <CloseCard
      chatId={CHAT}
      busy={busy}
      newSessionHref="/new"
      onRated={onRated}
    />,
  );
}

test("shows the Topic's new state and each KC practised with its next review", async () => {
  renderCard();
  const card = screen.getByRole("region", { name: "Session summary" });
  expect(await within(card).findByText("Thrust basics")).toBeVisible();
  expect(within(card).getByLabelText("Topic state: In progress")).toBeVisible();
  const kcs = within(card).getByRole("list", { name: "KCs practised" });
  expect(
    within(kcs)
      .getAllByRole("listitem")
      .map((li) => li.textContent),
  ).toEqual([
    "Thrust equationLearningNext review 2026-10-27",
    "Mass flowNewNo review planned",
  ]);
  expect(
    within(card).getByRole("link", { name: "Start new session" }),
  ).toHaveAttribute("href", "/new");
});

test("saves a rating with its note, which ends the session", async () => {
  renderCard();
  const card = screen.getByRole("region", { name: "Session summary" });
  const save = await within(card).findByRole("button", { name: "Save rating" });
  expect(save).toBeDisabled();

  fireEvent.click(within(card).getByRole("radio", { name: "Rating 4 of 5" }));
  fireEvent.change(within(card).getByRole("textbox", { name: "Note" }), {
    target: { value: "Clear." },
  });
  fireEvent.click(save);

  expect(await within(card).findByText("Rating saved")).toBeVisible();
  expect(rateStudySession).toHaveBeenCalledWith({
    chatId: CHAT,
    rating: 4,
    note: "Clear.",
  });
  expect(onRated).toHaveBeenCalledOnce();
  expect(within(card).getByRole("heading")).toHaveTextContent("Session ended");
});

test("waits for the reply before reading the summary, and keeps a note to 300 characters", async () => {
  const { rerender } = renderCard(true);
  expect(getSessionSummary).not.toHaveBeenCalled();
  rerender(
    <CloseCard
      chatId={CHAT}
      busy={false}
      newSessionHref="/new"
      onRated={onRated}
    />,
  );
  const card = screen.getByRole("region", { name: "Session summary" });
  fireEvent.click(
    await within(card).findByRole("radio", { name: "Rating 2 of 5" }),
  );
  fireEvent.change(within(card).getByRole("textbox", { name: "Note" }), {
    target: { value: "x".repeat(301) },
  });
  expect(within(card).getByRole("alert")).toHaveTextContent("at most 300");
  expect(
    within(card).getByRole("button", { name: "Save rating" }),
  ).toBeDisabled();
});
