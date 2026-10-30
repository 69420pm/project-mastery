import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type {
  KcView,
  KnowledgeMapView,
  MapKcLearning,
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
  prerequisites: [{ from: "k1", to: "k2" }],
  exercises: [
    {
      id: "e1",
      name: "Ex. 7.2b",
      kcs: ["k2"],
      difficulty: 3,
      question: "Find the exit speed.",
      solution: "About 2 km/s.",
    },
  ],
  checkReport: null,
  canBuild: true,
};

const renderMap = (learning: MapKcLearning = {}) =>
  render(
    <KnowledgeMap
      map={map}
      priorities={{
        kcs: {
          k2: { level: "high", value: 0.8, reasons: ["Exam"] },
        },
      }}
      learning={learning}
    />,
  );

test("clicking a KC node opens its panel", async () => {
  renderMap({
    k2: {
      state: "learning",
      nextReview: "2026-10-20",
      retrievability: 0.934,
      attempts: [
        {
          createdAt: "2026-10-15T10:00:00Z",
          result: "full",
          help: "some",
          exerciseId: null,
        },
      ],
    },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Nozzles" }));

  const panel = screen.getByRole("complementary", { name: "KC details" });
  const section = (name: string) => within(panel).getByRole("region", { name });
  expect(section("Overview")).toHaveTextContent("About Nozzles.");
  expect(section("Learning")).toHaveTextContent("Recall today93%");
  expect(section("Learning")).toHaveTextContent("Next review");
  expect(section("Learning")).toHaveTextContent("Fullsome help");
  expect(section("Priority")).toHaveTextContent("0.80");

  // A Prerequisite in the panel selects that KC.
  fireEvent.click(
    within(section("Links")).getAllByRole("button", { name: "Momentum" })[0]!,
  );
  expect(section("Overview")).toHaveTextContent("About Momentum.");
  expect(section("Priority")).toHaveTextContent("No Priority yet.");
  expect(section("Links")).toHaveTextContent("Nozzles");
});

test("an Exercise node shows its difficulty and opens its panel", async () => {
  renderMap({
    k2: {
      state: "learning",
      nextReview: null,
      retrievability: null,
      attempts: [
        {
          createdAt: "2026-10-15T10:00:00Z",
          result: "wrong",
          help: "none",
          exerciseId: "e1",
        },
      ],
    },
  });
  const node = await screen.findByRole("button", { name: "Ex. 7.2b" });
  expect(node).toHaveTextContent("Hard");
  fireEvent.click(node);

  const panel = screen.getByRole("complementary", { name: "Exercise details" });
  const section = (name: string) => within(panel).getByRole("region", { name });
  expect(section("Question")).toHaveTextContent("Find the exit speed.");
  expect(section("Solution")).toHaveTextContent("Show the solution");
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
  renderMap();
  fireEvent.click(await screen.findByRole("button", { name: "Ex. 7.2b" }));
  expect(faded("Nozzles")).toBe(false);
  expect(faded("Momentum")).toBe(true);

  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(faded("Momentum")).toBe(false);
});

test("the check report has no box of its own", async () => {
  renderWith(withDuplicate);
  await screen.findByRole("button", { name: "Nozzles" });
  expect(screen.queryByText(/KCs without links/)).toBeNull();
});

test("the graph has zoom buttons and no library attribution", async () => {
  renderWith(withDuplicate);
  await screen.findByRole("button", { name: "Nozzles" });
  expect(screen.getByRole("button", { name: "Zoom in" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Zoom out" })).toBeVisible();
  expect(screen.queryByRole("link", { name: /React Flow/ })).toBeNull();
});

const withDuplicate = {
  ...map,
  checkReport: {
    kcsPerPart: [],
    partsWithoutKcs: [],
    exercisesWithoutKcs: [],
    duplicates: [{ a: "Nozzles", b: "Jet nozzles", similarity: 0.9 }],
  },
};

const renderWith = (view: KnowledgeMapView) =>
  render(<KnowledgeMap map={view} priorities={{ kcs: {} }} learning={{}} />);

test("a KC node shows its check-report badges", async () => {
  renderWith(withDuplicate);
  const node = await screen.findByRole("button", { name: "Nozzles" });
  const badge = "Possible duplicate of Jet nozzles";
  expect(within(node).getByRole("img", { name: badge })).toBeVisible();
  const other = screen.getByRole("button", { name: "Momentum" });
  expect(within(other).queryByRole("img", { name: badge })).toBeNull();
});

describe("saved settings", () => {
  const legend = () => screen.getByRole("list", { name: "Legend" });

  test("a legend for the default colouring, then the saved one", async () => {
    localStorage.clear();
    const first = renderWith(withDuplicate);
    await screen.findByRole("button", { name: "Nozzles" });
    expect(legend()).toHaveTextContent("Known");
    first.unmount();

    localStorage.setItem(
      "knowledge-map-settings",
      JSON.stringify({ colorBy: "bigIdea", layers: { exercises: false } }),
    );
    renderWith(withDuplicate);
    await screen.findByRole("button", { name: "Nozzles" });
    expect(legend()).toHaveTextContent("Thrust");
    expect(screen.queryByRole("button", { name: "Ex. 7.2b" })).toBeNull();
  });

  test("an invalid saved value falls back to the defaults", async () => {
    localStorage.setItem("knowledge-map-settings", "{broken");
    renderWith(withDuplicate);
    await screen.findByRole("button", { name: "Nozzles" });
    expect(legend()).toHaveTextContent("Known");
    expect(screen.getByRole("button", { name: "Ex. 7.2b" })).toBeVisible();
    localStorage.clear();
  });
});

test("a Big idea opens its KC count per state", async () => {
  renderMap();
  fireEvent.click(await screen.findByRole("button", { name: "Thrust" }));
  const panel = screen.getByRole("complementary", { name: "Big idea details" });
  expect(within(panel).getByRole("region", { name: "KCs" })).toHaveTextContent(
    "All2New2Learning0",
  );
});
