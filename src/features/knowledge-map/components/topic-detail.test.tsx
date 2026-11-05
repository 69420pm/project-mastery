import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type {
  KcView,
  KnowledgeMapView,
  MapTopic,
  MapTopicDetail,
} from "@/features/knowledge-map/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
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

const { TopicDetail } = await import("./topic-detail");

const kc = (
  id: string,
  name: string,
  origin: KcView["origin"] = "content",
) => ({
  id,
  name,
  description: "",
  origin,
  sources: [],
});

const map: KnowledgeMapView = {
  courseId: "c1",
  build: { status: "built", failureReason: null, finishedAt: null },
  kcs: [
    kc("k1", "Momentum"),
    kc("k2", "Nozzles"),
    kc("k3", "Staging"),
    kc("p1", "Algebra", "exercise"),
  ],
  prerequisites: [
    { from: "k1", to: "k2" },
    { from: "p1", to: "k2" },
    { from: "k2", to: "k3" },
  ],
  exercises: [],
  checkReport: null,
  canBuild: true,
};

// Basics holds a KC of its own and the Topic Nozzle flow.
const basics: MapTopic = {
  id: "t1",
  parentId: null,
  name: "Basics",
  centralQuestion: "What pushes a rocket?",
  kcs: [{ id: "k1", name: "Momentum" }],
};
const nozzleFlow: MapTopic = {
  id: "t2",
  parentId: "t1",
  name: "Nozzle flow",
  centralQuestion: "How does a nozzle speed up gas?",
  kcs: [{ id: "k2", name: "Nozzles" }],
};
const stages: MapTopic = {
  id: "t3",
  parentId: null,
  name: "Stages",
  centralQuestion: "Why stage?",
  kcs: [{ id: "k3", name: "Staging" }],
};
const topics = [basics, nozzleFlow, stages];

const topic: MapTopicDetail = {
  ...nozzleFlow,
  anchors: [
    { id: "k1", name: "Momentum" },
    { id: "p1", name: "Algebra" },
  ],
  readingSections: [
    { label: "Lecture 1, pp. 2–4", href: "/courses/c1/materials/m1#chunk-x" },
  ],
};

const renderTopic = (detail: MapTopicDetail) =>
  render(
    <TopicDetail
      courseId="c1"
      topic={detail}
      topics={topics}
      map={map}
      priorities={{ kcs: {} }}
      learning={{}}
      topicState={{ state: "solid", recall: 0.91 }}
      badges={["pinned", "skipped"]}
      controls={<button type="button">Pin</button>}
    />,
  );

describe("TopicDetail", () => {
  test("shows the name, the Topic it sits in and question", () => {
    renderTopic(topic);
    expect(
      screen.getByRole("heading", { level: 1, name: "Nozzle flow" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Part of Basics")).toBeInTheDocument();
    expect(
      screen.getByText("How does a nozzle speed up gas?"),
    ).toBeInTheDocument();
  });

  test("a parent lists its own KCs and the Topics inside it", () => {
    renderTopic({ ...basics, anchors: [], readingSections: [] });
    expect(
      within(screen.getByRole("region", { name: "KCs" })).getByText("Momentum"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Topics inside" })).getByRole(
        "link",
        { name: "Nozzle flow" },
      ),
    ).toHaveAttribute("href", "/courses/c1/map/t2");
  });

  test("a parent without KCs of its own shows no state, question or KC graph", () => {
    renderTopic({
      ...basics,
      centralQuestion: null,
      kcs: [],
      anchors: [],
      readingSections: [],
    });
    expect(screen.queryByRole("region", { name: "KCs" })).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Central question" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Pin" })).toBeNull();
    expect(screen.getByRole("region", { name: "Topics inside" })).toBeVisible();
  });

  test("shows the plan badges and the pin and skip controls", () => {
    renderTopic(topic);
    expect(screen.getByLabelText("Plan")).toHaveTextContent("pinned");
    expect(screen.getByLabelText("Plan")).toHaveTextContent("skipped");
    expect(screen.getByRole("button", { name: "Pin" })).toBeInTheDocument();
  });

  test("shows the Topic state and recall today", () => {
    renderTopic(topic);
    expect(screen.getByLabelText("Topic state: Solid")).toBeInTheDocument();
    expect(screen.getByText("Recall today 91%")).toBeInTheDocument();
  });

  test("links an anchor to its Topic and shows one in no Topic as text", () => {
    renderTopic(topic);
    const anchors = screen.getByRole("region", { name: "Anchors" });
    expect(
      within(anchors).getByRole("link", { name: "Momentum" }),
    ).toHaveAttribute("href", "/courses/c1/map/t1");
    expect(within(anchors).getByText("Algebra")).toBeInTheDocument();
    expect(
      within(anchors).queryByRole("link", { name: "Algebra" }),
    ).not.toBeInTheDocument();
  });

  test("lists the KCs, the Reading sections and the neighbouring Topics", () => {
    renderTopic(topic);
    expect(
      within(screen.getByRole("region", { name: "KCs" })).getByText("Nozzles"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Lecture 1, pp. 2–4" }),
    ).toHaveAttribute("href", "/courses/c1/materials/m1#chunk-x");
    expect(
      screen.getByRole("link", { name: /Previous: Basics/ }),
    ).toHaveAttribute("href", "/courses/c1/map/t1");
    expect(screen.getByRole("link", { name: /Next: Stages/ })).toHaveAttribute(
      "href",
      "/courses/c1/map/t3",
    );
  });

  test("has no previous link on the first Topic", () => {
    renderTopic({
      ...basics,
      anchors: [],
      readingSections: [],
    });
    expect(screen.queryByRole("link", { name: /Previous/ })).toBeNull();
    expect(
      screen.getByRole("link", { name: /Next: Nozzle flow/ }),
    ).toBeVisible();
  });
});
