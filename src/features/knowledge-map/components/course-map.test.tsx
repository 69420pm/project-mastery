import { cleanup, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type {
  KnowledgeMapView,
  MapTopic,
} from "@/features/knowledge-map/types";
import { ProgressLine } from "@/features/study";

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
        // ELK can finish after the test ends, when jsdom is gone. Ignore a
        // result that arrives once the component has unmounted.
        let mounted = true;
        void elk.layout(graph as never).then((result) => {
          if (mounted) setLaidOut(result);
        });
        return () => {
          mounted = false;
        };
      }, [graph]);
      return { laidOut, failed: false };
    },
  };
});

// Vitest globals are off, so Testing Library does not unmount after each test.
afterEach(() => {
  cleanup();
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

const plan: ComponentProps<typeof ProgressLine>["plan"] = {
  examDate: "2026-12-03",
  progress: { known: 34, total: 120, daysIn: 12, daysLeft: 30 },
};

const renderMap = (
  view: KnowledgeMapView,
  mapTopics: MapTopic[],
  progressPlan = plan,
) =>
  render(
    <CourseMap
      map={view}
      topics={mapTopics}
      learning={{}}
      topicStates={{ t1: { state: "needs_work", recall: 0.426 } }}
      topicReadiness={{ t1: 0.624 }}
      topicBadges={{ t2: ["pinned"] }}
      progressLine={<ProgressLine plan={progressPlan} briefHref="/brief" />}
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

describe("the map check", () => {
  const weak = {
    ...map,
    checkReport: {
      chaptersWithoutKcs: ["Preface"],
      exercisesWithoutKcs: [],
      duplicates: [],
      unitsBelowCoverage: [{ chapter: "Bases", coverage: 0.3 }],
      unreadPages: [{ material: "Notes", pages: [10, 36, 37, 38] }],
    },
  };
  const renderCheck = (view: KnowledgeMapView, checkDetails: boolean) =>
    render(
      <CourseMap
        map={view}
        topics={[]}
        learning={{}}
        topicStates={{}}
        topicBadges={{}}
        progressLine={null}
        checkDetails={checkDetails}
      />,
    );

  test("tells the Student in one line what the AI missed, with Update map", () => {
    renderCheck(weak, false);
    const note = screen.getByRole("note", { name: "Map check" });
    expect(note).toHaveTextContent(
      "The AI couldn't read pp. 10, 36–38 and covered 1 Chapter only in part.",
    );
    expect(
      within(note).getByRole("button", { name: "Update map" }),
    ).toBeVisible();
    expect(within(note).queryByText("Check report")).toBeNull();
  });

  test("shows the full lists outside production", () => {
    renderCheck(weak, true);
    const note = screen.getByRole("note", { name: "Map check" });
    expect(note).toHaveTextContent("Chapters without KCs");
    expect(note).toHaveTextContent("Preface");
    expect(note).toHaveTextContent("Bases: 30%");
  });

  test("says nothing of a full build to the Student", () => {
    renderCheck(
      {
        ...weak,
        checkReport: {
          ...weak.checkReport,
          unitsBelowCoverage: [],
          unreadPages: [],
        },
      },
      false,
    );
    expect(screen.queryByRole("note", { name: "Map check" })).toBeNull();
  });
});

test("without a map, the page says so", () => {
  renderMap({ ...map, build: null, kcs: [] }, []);
  expect(screen.getByRole("heading", { name: "No map yet" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Build knowledge map" }),
  ).toBeVisible();
});

describe("the Progress line", () => {
  test("shows the bar and the line", () => {
    renderMap(map, topics);
    const bar = screen.getByRole("progressbar", { name: "Progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "34");
    expect(bar).toHaveAttribute("aria-valuemax", "120");
    expect(
      screen.getByText("34 of 120 KCs known · 12 days in · 30 days left"),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: /exam date/ })).toBeNull();
    expect(screen.getByText("Readiness line")).toBeVisible();
  });

  test("leaves out the days it lacks and links to the Brief without a date", () => {
    renderMap(map, topics, {
      examDate: null,
      progress: { known: 0, total: 1, daysIn: null, daysLeft: null },
    });
    expect(screen.getByText("0 of 1 KC known")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Add your exam date in the Brief" }),
    ).toHaveAttribute("href", "/brief");
  });

  test("reads Exam today on the exam day", () => {
    renderMap(map, topics, {
      ...plan,
      progress: { ...plan.progress, daysIn: 1, daysLeft: 0 },
    });
    expect(
      screen.getByText("34 of 120 KCs known · 1 day in · Exam today"),
    ).toBeVisible();
  });

  test("shows nothing without in-plan KCs", () => {
    renderMap(map, topics, {
      examDate: null,
      progress: { known: 0, total: 0, daysIn: 3, daysLeft: null },
    });
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("link", { name: /exam date/ })).toBeNull();
  });
});
