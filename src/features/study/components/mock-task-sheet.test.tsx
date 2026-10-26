import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { MockExamView } from "@/features/study/types";

const saveMockTaskAnswer = vi.fn();
const submitMockExam = vi.fn();
vi.mock("@/features/study/server/actions", () => ({
  saveMockTaskAnswer: (...args: unknown[]) => saveMockTaskAnswer(...args),
  submitMockExam: (...args: unknown[]) => submitMockExam(...args),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { MockTaskSheet } = await import("./mock-task-sheet");

const MOCK = "dddddddd-0000-4000-8000-000000000001";
const Q1 = "aaaaaaaa-0000-4000-8000-000000000001";
const Q2 = "aaaaaaaa-0000-4000-8000-000000000002";
// The device's clock runs an hour ahead of the server's.
const SERVER_NOW = "2026-10-26T10:00:00Z";
const DEVICE_NOW = "2026-10-26T11:00:00Z";

function sheet(minutesLeft: number) {
  const mock = {
    id: MOCK,
    status: "in_progress",
    serverNow: SERVER_NOW,
    deadline: new Date(
      Date.parse(SERVER_NOW) + minutesLeft * 60_000,
    ).toISOString(),
    tasks: [
      {
        questionId: Q1,
        prompt: "Compute the thrust.",
        points: 12,
        answer: null,
        confidence: null,
      },
      {
        questionId: Q2,
        prompt: "Name the stages.",
        points: 6,
        answer: "Four",
        confidence: 2,
      },
    ],
  } as MockExamView & { deadline: string };
  return render(<MockTaskSheet mock={mock} />);
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(DEVICE_NOW) });
  saveMockTaskAnswer
    .mockReset()
    .mockResolvedValue({ ok: true, data: undefined });
  submitMockExam.mockReset().mockResolvedValue({ ok: true, data: undefined });
  refresh.mockReset();
});
afterEach(() => vi.useRealTimers());

test("counts down from the server's deadline", () => {
  sheet(90);
  expect(screen.getByRole("timer", { name: "Time left" })).toHaveTextContent(
    "1:30:00",
  );
  act(() => {
    vi.advanceTimersByTime(61_000);
  });
  expect(screen.getByRole("timer")).toHaveTextContent("1:28:59");
});

test("saves an answer when the Student leaves its box, once per change", async () => {
  sheet(30);
  const box = screen.getByRole("textbox", { name: "Your answer" });
  fireEvent.change(box, { target: { value: "$F = 25$ kN" } });
  expect(screen.getByLabelText("Preview")).toHaveTextContent("25");
  fireEvent.blur(box);
  fireEvent.blur(box);
  await act(async () => {});

  expect(saveMockTaskAnswer).toHaveBeenCalledExactlyOnceWith({
    questionId: Q1,
    answer: "$F = 25$ kN",
    confidence: null,
  });
  expect(screen.getByRole("status")).toHaveTextContent("Saved");

  fireEvent.click(screen.getByRole("radio", { name: "Confidence 3 of 4" }));
  await act(async () => {});
  expect(saveMockTaskAnswer).toHaveBeenLastCalledWith({
    questionId: Q1,
    answer: "$F = 25$ kN",
    confidence: 3,
  });
});

test("navigates between the tasks, keeping their answers", () => {
  sheet(30);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Name the stages.")).toBeVisible();
  expect(screen.getByRole("textbox")).toHaveValue("Four");
  fireEvent.click(screen.getByRole("button", { name: "Task 1" }));
  expect(screen.getByText("Compute the thrust.")).toBeVisible();
});

test("submits itself at 0, saving the open answer first", async () => {
  sheet(1);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "25 kN" } });

  await act(async () => vi.advanceTimersByTime(60_000));

  expect(saveMockTaskAnswer).toHaveBeenCalledExactlyOnceWith({
    questionId: Q1,
    answer: "25 kN",
    confidence: null,
  });
  expect(submitMockExam).toHaveBeenCalledExactlyOnceWith({ mockId: MOCK });
  expect(refresh).toHaveBeenCalled();
});

test("submits only after a save still in flight has landed", async () => {
  let land = () => {};
  saveMockTaskAnswer.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        land = () => resolve({ ok: true, data: undefined });
      }),
  );
  sheet(1);
  const box = screen.getByRole("textbox");
  fireEvent.change(box, { target: { value: "25 kN" } });
  fireEvent.blur(box);

  await act(async () => vi.advanceTimersByTime(60_000));
  expect(submitMockExam).not.toHaveBeenCalled();

  await act(async () => land());
  expect(saveMockTaskAnswer).toHaveBeenCalledOnce();
  expect(submitMockExam).toHaveBeenCalledExactlyOnceWith({ mockId: MOCK });
});

test("Submit asks first", async () => {
  sheet(30);
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(
    screen.getByRole("alertdialog", { name: "Submit the mock exam?" }),
  ).toHaveTextContent("1 of 2 tasks have no answer.");
  expect(submitMockExam).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  await act(async () => {});
  expect(submitMockExam).toHaveBeenCalledWith({ mockId: MOCK });
});
