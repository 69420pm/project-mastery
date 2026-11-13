import { render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, test, vi } from "vitest";
import { ProgressLine } from "@/features/study";
import { BriefPanel } from "./brief-panel";

// The study feature's index also exports its Memory card's server action.
vi.mock("server-only", () => ({}));

type Props = ComponentProps<typeof BriefPanel>;

const brief: Props["brief"] = {
  fields: {
    examDate: null,
    goal: null,
    openBook: null,
    formulaSheet: null,
    calculator: null,
    scopeConfirmed: false,
  },
  notes: null,
  notesUpdatedAt: null,
  excludedMaterials: [],
  oldExams: [],
  examScopes: [],
  reservedExam: null,
};

type Plan = ComponentProps<typeof ProgressLine>["state"];

const noProgress: Plan = {
  examDate: null,
  progress: { learned: 0, total: 0, daysIn: null, daysLeft: null },
};

const renderPanel = (
  overrides: { brief?: Partial<Props["brief"]>; plan?: Plan } = {},
) =>
  render(
    <BriefPanel
      brief={{ ...brief, ...overrides.brief }}
      progress={
        <ProgressLine
          state={overrides.plan ?? noProgress}
          empty="No KCs in the plan yet"
        />
      }
      memory={<p>Memory slot</p>}
    />,
  );

describe("the Progress section", () => {
  const section = () => screen.getByRole("region", { name: "Progress" });

  test("shows the bar and the line, leaving out the days it lacks", () => {
    renderPanel({
      plan: {
        examDate: "2026-12-03",
        progress: { learned: 3, total: 10, daysIn: null, daysLeft: 1 },
      },
    });
    expect(
      within(section()).getByRole("progressbar", { name: "Progress" }),
    ).toHaveAttribute("aria-valuenow", "3");
    expect(
      within(section()).getByText("3 of 10 KCs learned · 1 day left"),
    ).toBeVisible();
    expect(screen.queryByRole("region", { name: "Study plan" })).toBeNull();
  });

  test("says so without in-plan KCs", () => {
    renderPanel();
    expect(within(section()).queryByRole("progressbar")).toBeNull();
    expect(within(section()).getByText("No KCs in the plan yet")).toBeVisible();
  });
});

test("shows the reserved exam as a row of the exam facts, or None once answered", () => {
  const { unmount } = renderPanel({
    brief: { reservedExam: { name: "Exam 2024", href: "/exam" } },
  });
  expect(screen.getByRole("link", { name: "Exam 2024" })).toHaveAttribute(
    "href",
    "/exam",
  );
  unmount();
  renderPanel({ brief: { reservedExam: "none" } });
  const label = screen.getByText("Reserved exam");
  expect(label.tagName).toBe("DT");
  expect(label.nextElementSibling).toHaveTextContent("None");
  expect(screen.queryByText("Reserved exam:")).toBeNull();
});

describe("BriefPanel", () => {
  test("shows Not set for unanswered fields and None for empty sections", () => {
    renderPanel();

    const exam = screen.getByRole("region", { name: "Exam" });
    expect(within(exam).getAllByText("Not set")).toHaveLength(5);
    for (const name of [
      "Excluded Materials",
      "Old exams",
      "Exam scope",
      "Notes",
    ]) {
      expect(
        within(screen.getByRole("region", { name })).getByText("None"),
      ).toBeVisible();
    }
    expect(screen.getByText("Memory slot")).toBeVisible();
  });

  test("shows the values that are set, with false as No", () => {
    renderPanel({
      brief: {
        fields: {
          examDate: "2026-12-03",
          goal: "good_grade",
          openBook: false,
          formulaSheet: true,
          calculator: false,
          scopeConfirmed: true,
        },
      },
    });

    const exam = screen.getByRole("region", { name: "Exam" });
    const value = (label: string) =>
      within(exam).getByText(label).nextElementSibling?.textContent;
    expect(value("Date")).toBe("Dec 3, 2026");
    expect(value("Goal")).toBe("A good grade");
    expect(value("Open book")).toBe("No");
    expect(value("Formula sheet")).toBe("Yes");
    expect(value("Calculator")).toBe("No");
    expect(value("Scope confirmed")).toBe("Yes");
    expect(within(exam).queryByText("Not set")).toBeNull();
  });

  test("links an excluded Material and shows notes with their Updated time", () => {
    renderPanel({
      brief: {
        notes: "Skip chapter 4.",
        notesUpdatedAt: "2026-10-05T12:00:00Z",
        excludedMaterials: [
          { id: "m1", name: "Old exam 2024", href: "/courses/c/materials/m1" },
        ],
      },
    });

    expect(
      within(
        screen.getByRole("region", { name: "Excluded Materials" }),
      ).getByRole("link", { name: "Old exam 2024" }),
    ).toHaveAttribute("href", "/courses/c/materials/m1");
    const notes = screen.getByRole("region", { name: "Notes" });
    expect(within(notes).getByText("Skip chapter 4.")).toBeVisible();
    expect(within(notes).getByText(/^Updated/)).toBeVisible();
    expect(notes.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-10-05T12:00:00Z",
    );
  });

  test("links the old exams and shows each exam scope with the Student's words", () => {
    renderPanel({
      brief: {
        oldExams: [{ id: "m2", name: "Klausur 2024", href: "/m/2" }],
        examScopes: [
          {
            name: "Eigenvalues",
            scope: "excluded",
            words: "Chapter 7 is not examined",
          },
        ],
      },
    });

    expect(
      within(screen.getByRole("region", { name: "Old exams" })).getByRole(
        "link",
        { name: "Klausur 2024" },
      ),
    ).toHaveAttribute("href", "/m/2");
    expect(
      screen.getByRole("region", { name: "Exam scope" }),
    ).toHaveTextContent("Excluded: Eigenvalues · “Chapter 7 is not examined”");
  });

  test("asks for no weekly hours or question style", () => {
    renderPanel();

    expect(screen.queryByText("Weekly hours")).toBeNull();
    expect(screen.queryByText("Question style")).toBeNull();
  });
});
