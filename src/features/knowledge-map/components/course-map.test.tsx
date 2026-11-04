import { render, screen, within } from "@testing-library/react";
import { beforeAll, expect, test, vi } from "vitest";
import type {
  KnowledgeMapView,
  MapTopic,
} from "@/features/knowledge-map/types";

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
  kcs: [kc("k1"), kc("k2")],
  prerequisites: [{ from: "k1", to: "k2" }],
  exercises: [],
  checkReport: null,
  canBuild: true,
};

const topics: MapTopic[] = [
  {
    id: "t1",
    parentId: null,
    name: "Momentum",
    centralQuestion: "Why does a rocket move forward?",
    kcs: [{ id: "k1", name: "k1" }],
  },
  {
    id: "t2",
    parentId: "t1",
    name: "Nozzles",
    centralQuestion: "How does a nozzle speed up its gas?",
    kcs: [{ id: "k2", name: "k2" }],
  },
];

const renderMap = (view: KnowledgeMapView, mapTopics: MapTopic[]) =>
  render(
    <CourseMap
      map={view}
      topics={mapTopics}
      learning={{}}
      topicStates={{ t1: { state: "needs_work", recall: 0.426 } }}
      topicReadiness={{ t1: 0.624 }}
      topicBadges={{ t2: ["pinned"] }}
      readinessLine={<p>Readiness line</p>}
    />,
  );

test("a card shows its plan badges", async () => {
  renderMap(map, topics);
  const card = await screen.findByRole("link", { name: "Nozzles" });
  expect(within(card).getByLabelText("Plan")).toHaveTextContent("pinned");
  const other = screen.getByRole("link", { name: "Momentum" });
  expect(within(other).queryByLabelText("Plan")).toBeNull();
});

test("each Topic is a card opening its Topic page", async () => {
  renderMap(map, topics);
  const graph = await screen.findByRole("application", {
    name: "Course map graph",
  });
  const card = await within(graph).findByRole("link", { name: "Momentum" });
  expect(card).toHaveTextContent("Why does a rocket move forward?");
  expect(card).toHaveAttribute("href", "/courses/c1/map/t1");
  // Momentum holds Nozzles: a box around its own card and Nozzles'.
  expect(within(graph).getByRole("group", { name: "Momentum" })).toBeVisible();
  expect(within(graph).getByRole("link", { name: "Nozzles" })).toBeVisible();
  // The KC graph is gone.
  expect(screen.queryByRole("button", { name: "k1" })).toBeNull();
});

test("each card shows its Topic state and recall today", async () => {
  renderMap(map, topics);
  const card = await screen.findByRole("link", { name: "Momentum" });
  expect(within(card).getByLabelText("Topic state: Needs work")).toBeVisible();
  expect(card).toHaveTextContent("Recall today 43%");
  // A Topic without a Topic state is new.
  const other = screen.getByRole("link", { name: "Nozzles" });
  expect(within(other).getByLabelText("Topic state: New")).toBeVisible();
  expect(other).toHaveTextContent("Recall today 0%");
});

test("the header shows the Readiness line and a card its Readiness", async () => {
  renderMap(map, topics);
  expect(screen.getByText("Readiness line")).toBeVisible();
  const card = await screen.findByRole("link", { name: "Momentum" });
  expect(card).toHaveTextContent("Readiness 62%");
  expect(screen.getByRole("link", { name: "Nozzles" })).not.toHaveTextContent(
    "Readiness",
  );
});

test("a map whose update stopped before its Topics asks for an update", () => {
  renderMap(map, []);
  expect(
    screen.getByRole("heading", { name: "Update map to finish your Topics" }),
  ).toBeVisible();
  expect(screen.getAllByRole("button", { name: "Update map" })).toHaveLength(2);
  expect(screen.queryByRole("application")).toBeNull();
});

test("without a map, the page says so", () => {
  renderMap({ ...map, build: null, kcs: [] }, []);
  expect(screen.getByRole("heading", { name: "No map yet" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Build knowledge map" }),
  ).toBeVisible();
});

test("shows no line about the plan's fit", () => {
  renderMap(map, topics);
  expect(screen.queryByLabelText("Study plan")).toBeNull();
});
