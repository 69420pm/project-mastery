import { render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, test } from "vitest";
import type { FindingView } from "@/features/knowledge-map";
import { BriefPanel } from "./brief-panel";

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

const plan: Props["plan"] = {
  phase: null,
  share: null,
  hoursPerWeek: null,
  leftOut: [],
};

const renderPanel = (
  overrides: {
    brief?: Partial<Props["brief"]>;
    findings?: FindingView[];
    plan?: Partial<Props["plan"]>;
  } = {},
) =>
  render(
    <BriefPanel
      brief={{ ...brief, ...overrides.brief }}
      findings={overrides.findings ?? []}
      plan={{ ...plan, ...overrides.plan }}
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

  test("shows the study plan with the left-out KC names", () => {
    renderPanel({
      plan: {
        phase: "build",
        share: 70,
        hoursPerWeek: 5,
        leftOut: [
          { id: "k1", name: "Momentum" },
          { id: "k2", name: "Nozzles" },
        ],
      },
    });

    const section = screen.getByRole("region", { name: "Study plan" });
    expect(within(section).getByText("Build phase")).toBeVisible();
    expect(within(section).getByText("70%")).toBeVisible();
    expect(within(section).getByText("Momentum")).toBeVisible();
    expect(within(section).getByText("Nozzles")).toBeVisible();
  });
});
