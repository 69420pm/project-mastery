import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type {
  KcView,
  KnowledgeMapView,
  MapKcLearning,
  MapPlan,
} from "@/features/knowledge-map/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("@/features/knowledge-map/server/actions", () => ({
  startKnowledgeMapBuild: vi.fn(),
}));
// The page lays the graph out in a web worker; here the same ELK runs
// in-process.
vi.mock("@/features/knowledge-map/hooks/use-graph-layout", async () => {
  const { useEffect, useState } = await import("react");
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  const elk = new ELK();
  return {
    useGraphLayout(graph: object) {
      const [laidOut, setLaidOut] = useState<object | null>(null);
      useEffect(() => {
        void elk.layout(graph as never).then(setLaidOut);
      }, [graph]);
      return laidOut;
    },
  };
});

beforeAll(() => {
  // What React Flow and the panel's breakpoint read, which jsdom lacks.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as MediaQueryList;
});

const { KnowledgeMap } = await import("./knowledge-map");

const kc = (id: string, name: string): KcView => ({
  id,
  name,
  description: `About ${name}.`,
  type: "concept",
  bloom: "apply",
  origin: "content",
  sources: [],
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
  prerequisites: [{ from: "k1", to: "k2", confidence: 0.9 }],
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

const renderMap = (overrides: Partial<MapPlan>, learning: MapKcLearning = {}) =>
  render(
    <KnowledgeMap
      map={map}
      briefHref="/brief"
      priorities={{
        running: false,
        failureReason: null,
        kcs: {
          k2: { level: "high", value: 0.8, multiplier: 1, reasons: ["Exam"] },
        },
      }}
      learning={learning}
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

test("clicking a KC node opens its panel", async () => {
  renderMap(
    { share: 50, leftOut: ["k2"] },
    {
      k2: {
        state: "learning",
        level: 2,
        nextReview: "2026-10-20",
        attempts: [
          {
            createdAt: "2026-10-15T10:00:00Z",
            correct: true,
            help: "some",
            exerciseId: null,
          },
        ],
        candidate: false,
        anchors: [],
      },
    },
  );
  fireEvent.click(await screen.findByRole("button", { name: "Nozzles" }));

  const panel = screen.getByRole("complementary", { name: "KC details" });
  const section = (name: string) => within(panel).getByRole("region", { name });
  expect(section("Overview")).toHaveTextContent("About Nozzles.");
  expect(section("Learning")).toHaveTextContent("2 of 5");
  expect(section("Learning")).toHaveTextContent("Correctsome help");
  expect(section("Priority")).toHaveTextContent("won't fit");
  expect(section("Priority")).toHaveTextContent("0.80");

  // A Prerequisite in the panel selects that KC.
  fireEvent.click(
    within(section("Links")).getByRole("button", { name: "Momentum" }),
  );
  expect(section("Overview")).toHaveTextContent("About Momentum.");
  expect(section("Priority")).toHaveTextContent("No Priority yet.");
});
