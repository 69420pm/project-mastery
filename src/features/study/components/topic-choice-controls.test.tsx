import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TopicChoiceControls } from "./topic-choice-controls";

const setTopicChoice = vi.fn();
vi.mock("@/features/study/server/actions", () => ({
  setTopicChoice: (input: unknown) => setTopicChoice(input),
}));

beforeEach(() => {
  setTopicChoice.mockReset();
  setTopicChoice.mockResolvedValue({ ok: true, data: { reasonKept: true } });
});

const renderControls = (choice: "pinned" | "skipped" | null) =>
  render(<TopicChoiceControls courseId="c1" topicId="t1" choice={choice} />);

describe("TopicChoiceControls", () => {
  test("pins a Topic with no choice", async () => {
    renderControls(null);
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    await waitFor(() =>
      expect(setTopicChoice).toHaveBeenCalledWith({
        courseId: "c1",
        topicId: "t1",
        choice: "pinned",
        reason: undefined,
      }),
    );
  });

  test("offers Unpin on a pinned Topic and clears the choice", async () => {
    renderControls("pinned");
    fireEvent.click(screen.getByRole("button", { name: "Unpin" }));
    await waitFor(() =>
      expect(setTopicChoice).toHaveBeenCalledWith(
        expect.objectContaining({ choice: null }),
      ),
    );
  });

  test("skips with a reason", async () => {
    renderControls(null);
    fireEvent.change(screen.getByLabelText("Reason for skipping (optional)"), {
      target: { value: "Not on my exam" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() =>
      expect(setTopicChoice).toHaveBeenCalledWith(
        expect.objectContaining({
          choice: "skipped",
          reason: "Not on my exam",
        }),
      ),
    );
  });

  test("offers Unskip, without a reason field, on a skipped Topic", () => {
    renderControls("skipped");
    expect(screen.getByRole("button", { name: "Unskip" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    expect(
      screen.queryByLabelText("Reason for skipping (optional)"),
    ).toBeNull();
  });

  test("says the reason wasn't kept when the Memory is full", async () => {
    setTopicChoice.mockResolvedValue({ ok: true, data: { reasonKept: false } });
    renderControls(null);
    fireEvent.change(screen.getByLabelText("Reason for skipping (optional)"), {
      target: { value: "Too hard" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "reason wasn't kept",
    );
  });
});
