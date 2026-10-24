import { render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, test, vi } from "vitest";
import type { FindingView } from "@/features/knowledge-map";
import { type StudyPlan, StudyPlanFacts } from "@/features/study";
import { BriefPanel } from "./brief-panel";

// The study feature's index also exports its Memory card's server action.
vi.mock("server-only", () => ({}));

type Props = ComponentProps<typeof BriefPanel>;

const brief: Props["brief"] = {
  fields: {
    examDate: null,
    goal: null,
    hoursPerWeek: null,
    questionStyle: null,
    openBook: null,
    formulaSheet: null,
    calculator: null,
    scopeConfirmed: false,
  },
  notes: null,
  notesUpdatedAt: null,
  excludedMaterials: [],
};

const plan: StudyPlan = {
  phase: null,
  topics: [],
  order: [],
  fit: null,
  hoursPerWeek: null,
};

const renderPanel = (
  overrides: {
    brief?: Partial<Props["brief"]>;
    findings?: FindingView[];
    plan?: Partial<StudyPlan>;
  } = {},
) =>
  render(
    <BriefPanel
      brief={{ ...brief, ...overrides.brief }}
      findings={overrides.findings ?? []}
      plan={<StudyPlanFacts plan={{ ...plan, ...overrides.plan }} />}
      memory={<p>Memory slot</p>}
    />,
  );

const finding = (overrides: Partial<FindingView>): FindingView => ({
  id: "f1",
  text: "Exercise 3 prints 48.2%.",
  status: "open",
  askedAt: null,
  answeredAt: null,
  answer: null,
  sources: [],
  ...overrides,
});

describe("BriefPanel", () => {
  test("shows Not set for unanswered fields and None for empty sections", () => {
    renderPanel();

    const exam = screen.getByRole("region", { name: "Exam" });
    expect(within(exam).getAllByText("Not set")).toHaveLength(7);
    for (const name of ["Excluded Materials", "Notes", "Findings"]) {
      expect(
        within(screen.getByRole("region", { name })).getByText("None"),
      ).toBeVisible();
    }
    expect(screen.getByText("No exam date")).toBeVisible();
    expect(screen.getByText("Memory slot")).toBeVisible();
  });

  test("shows an open and an answered Finding with its answer and sources", () => {
    renderPanel({
      findings: [
        finding({ id: "f1" }),
        finding({
          id: "f2",
          text: "Page 4 is blurry.",
          status: "answered",
          answer: "Ignore it",
          sources: [{ label: "Lecture 1 p. 4", href: "/m/1#chunk-a" }],
        }),
      ],
    });

    const items = within(
      screen.getByRole("region", { name: "Findings" }),
    ).getAllByRole("listitem");
    const [open, answered] = items as [HTMLElement, HTMLElement];
    expect(within(open).getByText("Open")).toBeVisible();
    expect(within(answered).getByText("Answered")).toBeVisible();
    expect(within(answered).getByText("Ignore it")).toBeVisible();
    expect(
      within(answered).getByRole("link", { name: "Lecture 1 p. 4" }),
    ).toHaveAttribute("href", "/m/1#chunk-a");
  });

  test("shows the values that are set, with false as No", () => {
    renderPanel({
      brief: {
        fields: {
          examDate: "2026-12-03",
          goal: "good_grade",
          hoursPerWeek: 5.5,
          questionStyle: "multiple_choice",
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
    expect(value("Weekly hours")).toBe("5.5 h");
    expect(value("Question style")).toBe("Multiple choice");
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

  test("keeps the Findings in the order given, open ones first", () => {
    renderPanel({
      findings: [
        finding({ id: "f1", text: "First open." }),
        finding({ id: "f2", text: "Second open." }),
        finding({ id: "f3", text: "Answered.", status: "answered" }),
      ],
    });

    const items = within(
      screen.getByRole("region", { name: "Findings" }),
    ).getAllByRole("listitem");
    expect(
      items.map(
        (item) => within(item).getByText(/^(Open|Answered)$/).textContent,
      ),
    ).toEqual(["Open", "Open", "Answered"]);
    expect(items[0]).toHaveTextContent("First open.");
  });

  test("shows the fit line with the names of the Topics that won't fit", () => {
    const topic = (id: string, name: string, fits: boolean) => ({
      id,
      name,
      priority: 1,
      topicState: { state: "new" as const, recall: 0 },
      status: "in_plan" as const,
      pinned: false,
      untaught: ["k"],
      fits,
    });
    renderPanel({
      plan: {
        phase: "build",
        hoursPerWeek: 5,
        topics: [
          topic("t1", "Thrust", true),
          topic("t2", "Momentum", false),
          topic("t3", "Nozzles", false),
        ],
        fit: { fitting: 1, inPlan: 3, examWeight: 33 },
      },
    });

    const section = screen.getByRole("region", { name: "Study plan" });
    expect(within(section).getByText("Build phase")).toBeVisible();
    expect(
      within(section).getByText(
        "Build phase. At your pace, 1 of 3 Topics fit, covering 33% of exam weight.",
      ),
    ).toBeVisible();
    const wontFit = within(section).getByRole("list", {
      name: "Topics that won't fit",
    });
    expect(wontFit).toHaveTextContent("Momentum");
    expect(wontFit).toHaveTextContent("Nozzles");
    expect(wontFit).not.toHaveTextContent("Thrust");
  });
});
