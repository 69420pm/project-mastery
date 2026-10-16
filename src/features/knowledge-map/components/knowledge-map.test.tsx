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
  semanticLinks: [
    { from: "k1", to: "k2", coreType: "causes", label: "speeds up" },
  ],
  exercises: [
    {
      id: "e1",
      name: "Ex. 7.2b",
      taskType: "calculate",
      kcs: ["k2"],
      solutionStatus: "disputed",
      difficulty: 3,
      question: "Find the exit speed.",
      solution: "About 2 km/s.",
    },
  ],
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
    within(section("Links")).getAllByRole("button", { name: "Momentum" })[0]!,
  );
  expect(section("Overview")).toHaveTextContent("About Momentum.");
  expect(section("Priority")).toHaveTextContent("No Priority yet.");
  expect(section("Links")).toHaveTextContent("speeds up");
});

test("an Exercise node shows its solution status and opens its panel", async () => {
  renderMap(
    {},
    {
      k2: {
        state: "learning",
        level: 1,
        nextReview: null,
        attempts: [
          {
            createdAt: "2026-10-15T10:00:00Z",
            correct: false,
            help: "none",
            exerciseId: "e1",
          },
        ],
        candidate: false,
        anchors: [],
      },
    },
  );
  const node = await screen.findByRole("button", { name: "Ex. 7.2b" });
  expect(node).toHaveTextContent("HardDisputed");
  fireEvent.click(node);

  const panel = screen.getByRole("complementary", { name: "Exercise details" });
  const section = (name: string) => within(panel).getByRole("region", { name });
  expect(section("Question")).toHaveTextContent("Find the exit speed.");
  expect(section("Solution")).toHaveTextContent("an AI solution disagrees");
  expect(section("Attempts")).toHaveTextContent("Wrongno helpNozzles");

  // A KC it tests selects that KC.
  fireEvent.click(
    within(section("Tests")).getByRole("button", { name: "Nozzles" }),
  );
  const kcPanel = screen.getByRole("complementary", { name: "KC details" });
  expect(
    within(kcPanel).getByRole("region", { name: "Exercises" }),
  ).toHaveTextContent("Ex. 7.2battempted");
});

const faded = (name: string) =>
  within(screen.getByRole("application", { name: "Knowledge map graph" }))
    .getByRole("button", { name })
    .closest(".react-flow__node")!
    .classList.contains("opacity-30");

test("a selected node focuses its neighbours until Esc", async () => {
  renderMap({});
  fireEvent.click(await screen.findByRole("button", { name: "Ex. 7.2b" }));
  expect(faded("Nozzles")).toBe(false);
  expect(faded("Momentum")).toBe(true);

  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(faded("Momentum")).toBe(false);
});

test("a check-report item highlights the KCs it names", async () => {
  render(
    <KnowledgeMap
      map={{
        ...map,
        checkReport: {
          uncoveredChunks: [],
          ungroundedKcs: [],
          orphanKcs: ["Nozzles"],
          droppedCycleEdges: [],
          unmappedExercises: [],
          untestedKcs: [],
          duplicates: [],
        },
      }}
      briefHref="/brief"
      priorities={{ running: false, failureReason: null, kcs: {} }}
      learning={{}}
      plan={plan({})}
    />,
  );
  await screen.findByRole("button", { name: "Nozzles" });
  const item = screen.getByRole("button", {
    name: "KCs without links: Nozzles",
  });
  fireEvent.click(item);
  expect(item).toHaveAttribute("aria-pressed", "true");
  expect(faded("Nozzles")).toBe(false);
  expect(faded("Momentum")).toBe(true);

  fireEvent.click(item);
  expect(faded("Momentum")).toBe(false);
});

test("a Big idea opens its KC count per state", async () => {
  renderMap({});
  fireEvent.click(await screen.findByRole("button", { name: "Thrust" }));
  const panel = screen.getByRole("complementary", { name: "Big idea details" });
  expect(within(panel).getByRole("region", { name: "KCs" })).toHaveTextContent(
    "All2New2Learning0",
  );
});
