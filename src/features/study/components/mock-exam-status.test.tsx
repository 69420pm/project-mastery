import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { MockExamView, MockTask } from "@/features/study/types";

vi.mock("@/features/study/server/actions", () => ({
  startMockExam: vi.fn(),
  queueMockExam: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const { MockExamStatus } = await import("./mock-exam-status");

const TUTOR = "/courses/c/chats/new?mode=results&mock=m";

const task = (n: number, more: Partial<MockTask> = {}): MockTask => ({
  questionId: `q${n}`,
  prompt: `Task statement ${n}.`,
  points: 6,
  answer: `Answer ${n}.`,
  confidence: 3,
  grade: null,
  ...more,
});

const view = (more: Partial<MockExamView>) =>
  ({
    id: "m",
    courseId: "c",
    status: "submitted",
    tasks: [task(1), task(2), task(3)],
    grading: { done: 0, total: 3 },
    result: null,
    ...more,
  }) as MockExamView;

test("a submitted mock shows which task grading is on", () => {
  render(
    <MockExamStatus
      mock={view({ grading: { done: 2, total: 3 } })}
      tutorHref={TUTOR}
    />,
  );

  expect(screen.getByRole("status")).toHaveTextContent("Grading task 3 of 3…");
});

test("a graded mock shows the score against the prediction, per Topic and per task", () => {
  const mock = view({
    status: "graded",
    grading: { done: 3, total: 3 },
    tasks: [
      task(1, {
        grade: {
          status: "graded",
          pointsAwarded: 3.5,
          steps: [{ points: 3.5, reason: "You set up the momentum balance." }],
          check: "mismatch",
        },
      }),
      task(2, {
        answer: null,
        grade: { status: "graded", pointsAwarded: 0, steps: [], check: null },
      }),
      task(3, { grade: { status: "failed" } }),
    ],
    result: {
      scorePercent: 29,
      predictedPercent: 64,
      topics: [{ name: "Thrust", awarded: 3.5, points: 12 }],
      sure: { right: 7, total: 9 },
    },
  });

  render(<MockExamStatus mock={mock} tutorHref={TUTOR} />);

  expect(
    screen.getByText("We predicted 64%, you scored 29%"),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      "Your sure answers (confidence 4) were right 7 of 9 times",
    ),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("table", { name: "Points per Topic" })).getByRole(
      "row",
      { name: "Thrust 3.5 / 12" },
    ),
  ).toBeInTheDocument();
  const first = screen.getByRole("listitem", { name: "Task 1" });
  expect(first).toHaveTextContent("3.5 of 6 points");
  expect(first).toHaveTextContent("You set up the momentum balance.");
  expect(first).toHaveTextContent("does not match");
  expect(screen.getByRole("listitem", { name: "Task 2" })).toHaveTextContent(
    "No answer",
  );
  expect(screen.getByRole("listitem", { name: "Task 3" })).toHaveTextContent(
    "This task could not be graded.",
  );
  expect(
    screen.getByRole("link", { name: "Go through it with the tutor" }),
  ).toHaveAttribute("href", TUTOR);
});
