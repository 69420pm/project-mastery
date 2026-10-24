import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type {
  KnowledgeMapView,
  MapTopic,
} from "@/features/knowledge-map/types";
import { PlanLine, type StudyPlan } from "@/features/study";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
// The study feature's index also exports its Memory card's server action.
vi.mock("server-only", () => ({}));
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
      return { laidOut, failed: false };
    },
  };
});

beforeAll(() => {
  // What React Flow reads, which jsdom lacks.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const { CourseMap } = await import("./course-map");

const kc = (id: string) => ({
  id,
  name: id,
  description: "",
  type: "concept" as const,
  bloom: null,
  origin: "content" as const,
  sources: [],
});

const map: KnowledgeMapView = {
  courseId: "c1",
  build: {
    status: "built",
    failureReason: null,
    finishedAt: "2026-10-20T10:00:00Z",
  },
  bigIdeas: [
    { id: "b1", name: "Thrust", description: "", kcs: [kc("k1"), kc("k2")] },
  ],
  priorKnowledge: [],
  prerequisites: [{ from: "k1", to: "k2", confidence: 0.9 }],
  semanticLinks: [],
  exercises: [],
  checkReport: null,
  canBuild: true,
};

const topics: MapTopic[] = [
  {
    id: "t1",
    bigIdeaId: "b1",
    name: "Momentum",
    centralQuestion: "Why does a rocket move forward?",
    kcs: [{ id: "k1", name: "k1" }],
  },
  {
    id: "t2",
    bigIdeaId: "b1",
    name: "Nozzles",
    centralQuestion: "How does a nozzle speed up its gas?",
    kcs: [{ id: "k2", name: "k2" }],
  },
];

const plan: StudyPlan = {
  phase: "build",
  share: 100,
  leftOut: [],
  hoursPerWeek: 5,
};

const renderMap = (
  view: KnowledgeMapView,
  mapTopics: MapTopic[],
  studyPlan: StudyPlan = plan,
) =>
  render(
    <CourseMap
      map={view}
      topics={mapTopics}
      priorities={{ running: false, failureReason: null, kcs: {} }}
      learning={{}}
      planLine={<PlanLine plan={studyPlan} briefHref="/brief" />}
    />,
  );

test("each Topic is a card opening its Topic page", async () => {
  renderMap(map, topics);
  const graph = await screen.findByRole("application", {
    name: "Course map graph",
  });
  const card = await within(graph).findByRole("link", { name: "Momentum" });
  expect(card).toHaveTextContent("Why does a rocket move forward?");
  expect(card).toHaveAttribute("href", "/courses/c1/map/t1");
  expect(within(graph).getByText("Thrust")).toBeVisible();
  expect(within(graph).getByRole("link", { name: "Nozzles" })).toBeVisible();
  // The KC graph is gone.
  expect(screen.queryByRole("button", { name: "k1" })).toBeNull();
});

test("a built map without Topics asks for an update", () => {
  renderMap(map, []);
  expect(
    screen.getByRole("heading", {
      name: "Update map to group your KCs into Topics",
    }),
  ).toBeVisible();
  expect(screen.getAllByRole("button", { name: "Update map" })).toHaveLength(2);
  expect(screen.queryByRole("application")).toBeNull();
});

test("without a map, the page says so", () => {
  renderMap({ ...map, build: null, bigIdeas: [] }, []);
  expect(screen.getByRole("heading", { name: "No map yet" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Build knowledge map" }),
  ).toBeVisible();
});

describe("the plan line", () => {
  const planLine = () => screen.getByLabelText("Study plan");

  test.each<[string, Partial<StudyPlan>, string]>([
    [
      "left-out KCs",
      {
        share: 70,
        leftOut: [
          { id: "k1", name: "k1" },
          { id: "k2", name: "k2" },
        ],
      },
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
    renderMap(map, topics, { ...plan, ...overrides });
    expect(planLine()).toHaveTextContent(text);
  });

  test("links to the Brief without a Phase", () => {
    renderMap(map, topics, {
      ...plan,
      phase: null,
      share: null,
      hoursPerWeek: null,
    });
    expect(
      within(planLine()).getByRole("link", {
        name: "Add your exam date and weekly hours in the Brief to see your pace.",
      }),
    ).toHaveAttribute("href", "/brief");
  });
});
