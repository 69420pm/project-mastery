import { render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type {
  KcView,
  KnowledgeMapView,
  MapPlan,
} from "@/features/knowledge-map/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("@/features/knowledge-map/server/actions", () => ({
  startKnowledgeMapBuild: vi.fn(),
}));

const { KnowledgeMap } = await import("./knowledge-map");

const kc = (id: string, name: string): KcView => ({
  id,
  name,
  description: name,
  type: "concept",
  bloom: null,
  fromExercise: false,
  sources: [],
  prerequisites: [],
});

const map: KnowledgeMapView = {
  courseId: "c1",
  build: { status: "built", failureReason: null, finishedAt: null },
  bigIdeas: [
    {
      id: "b1",
      name: "Thrust",
      description: "Thrust.",
      kcs: [kc("k1", "Momentum"), kc("k2", "Nozzles")],
    },
  ],
  priorKnowledge: [],
  semanticLinks: [],
  exercises: [],
  checkReport: null,
  canBuild: true,
};

const plan = (overrides: Partial<MapPlan>): MapPlan => ({
  phase: "build",
  share: 100,
  leftOut: [],
  hoursPerWeek: 5,
  ...overrides,
});

const renderMap = (overrides: Partial<MapPlan>) =>
  render(
    <KnowledgeMap
      map={map}
      briefHref="/brief"
      priorities={{ running: false, failureReason: null, kcs: {} }}
      kcStates={{}}
      plan={plan(overrides)}
    />,
  );

const planLine = () => screen.getByLabelText("Study plan");

describe("the plan line", () => {
  test.each<[string, Partial<MapPlan>, string]>([
    [
      "left-out KCs",
      { share: 70, leftOut: ["k1", "k2"] },
      "Build phase. At 5 h/week until the final week, about 70% of the KCs that matter fit; 2 lowest-Priority KCs won't.",
    ],
    [
      "everything fitting",
      { phase: "deepen" },
      "Deepen phase. At 5 h/week until the final week, all KCs that matter fit.",
    ],
    [
      "the final week",
      { phase: "final_week", share: null },
      "Final week: review what you've learned.",
    ],
    [
      "no hours",
      { share: null, hoursPerWeek: null },
      "Build phase. Add your weekly hours in the Brief to see your pace.",
    ],
  ])("shows %s", (_, overrides, text) => {
    renderMap(overrides);
    expect(planLine()).toHaveTextContent(text);
  });

  test("links to the Brief without a Phase", () => {
    renderMap({ phase: null, share: null, hoursPerWeek: null });
    expect(
      within(planLine()).getByRole("link", {
        name: "Add your exam date and weekly hours in the Brief to see your pace.",
      }),
    ).toHaveAttribute("href", "/brief");
  });
});

test("marks left-out KCs as won't fit", () => {
  renderMap({ share: 50, leftOut: ["k2"] });
  expect(
    within(screen.getByRole("article", { name: "Nozzles" })).getByText(
      "won't fit",
    ),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("article", { name: "Momentum" })).queryByText(
      "won't fit",
    ),
  ).toBeNull();
});
