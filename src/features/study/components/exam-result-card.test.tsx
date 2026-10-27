import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const saveExamResult = vi.fn();
vi.mock("@/features/study/server/actions", () => ({
  saveExamResult: (...args: unknown[]) => saveExamResult(...args),
}));

const { ExamResultCard } = await import("./exam-result-card");

beforeEach(() => {
  saveExamResult.mockReset().mockResolvedValue({ ok: true, data: undefined });
});

test("asks how the exam went and saves the grade for the exam date", async () => {
  render(<ExamResultCard courseId="c1" examDate="2026-10-20" />);
  expect(screen.getByText("How did the exam go?")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  fireEvent.change(screen.getByRole("textbox", { name: "Your grade" }), {
    target: { value: " 1.7 " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(saveExamResult).toHaveBeenCalledWith({
      courseId: "c1",
      examDate: "2026-10-20",
      grade: "1.7",
    }),
  );
});

test("Skip stores no grade", async () => {
  render(<ExamResultCard courseId="c1" examDate="2026-10-20" />);
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  await waitFor(() =>
    expect(saveExamResult).toHaveBeenCalledWith({
      courseId: "c1",
      examDate: "2026-10-20",
      grade: null,
    }),
  );
});

test("shows why saving failed", async () => {
  saveExamResult.mockResolvedValue({ ok: false, message: "Not found." });
  render(<ExamResultCard courseId="c1" examDate="2026-10-20" />);
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Not found.");
});
