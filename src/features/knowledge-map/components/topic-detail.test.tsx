import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";
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

const { TopicDetail } = await import("./topic-detail");

const kc = (
  id: string,
  name: string,
  origin: KcView["origin"] = "content",
) => ({
  id,
  name,
  description: "",
  type: "concept" as const,
  bloom: null,
  origin,
  sources: [],
});

const map: KnowledgeMapView = {
  courseId: "c1",
  build: { status: "built", failureReason: null, finishedAt: null },
  bigIdeas: [
    {
      id: "b1",
      name: "Thrust",
      description: "",
      kcs: [kc("k1", "Momentum"), kc("k2", "Nozzles"), kc("k3", "Staging")],
    },
  ],
  priorKnowledge: [kc("p1", "Algebra", "prior")],
  prerequisites: [
    { from: "k1", to: "k2", confidence: 1 },
    { from: "p1", to: "k2", confidence: 1 },
    { from: "k2", to: "k3", confidence: 1 },
  ],
  semanticLinks: [],
  exercises: [],
  checkReport: null,
  canBuild: true,
};

const basics: MapTopic = {
  id: "t1",
  bigIdeaId: "b1",
  name: "Basics",
  centralQuestion: "What pushes a rocket?",
  kcs: [{ id: "k1", name: "Momentum" }],
};
const nozzleFlow: MapTopic = {
  id: "t2",
  bigIdeaId: "b1",
  name: "Nozzle flow",
  centralQuestion: "How does a nozzle speed up gas?",
  kcs: [{ id: "k2", name: "Nozzles" }],
};
const stages: MapTopic = {
  id: "t3",
  bigIdeaId: "b1",
  name: "Stages",
  centralQuestion: "Why stage?",
  kcs: [{ id: "k3", name: "Staging" }],
};
const topics = [basics, nozzleFlow, stages];

const topic: MapTopicDetail = {
  ...nozzleFlow,
  whyItMatters: "Exit speed sets the thrust.",
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
      priorities={{ running: false, failureReason: null, kcs: {} }}
      learning={{}}
      topicState={{ state: "solid", recall: 0.91 }}
      badges={["pinned", "won't fit"]}
      controls={<button type="button">Pin</button>}
    />,
  );

describe("TopicDetail", () => {
  test("shows the name, Big idea, question and why it matters", () => {
    renderTopic(topic);
    expect(
      screen.getByRole("heading", { level: 1, name: "Nozzle flow" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Big idea: Thrust")).toBeInTheDocument();
    expect(
      screen.getByText("How does a nozzle speed up gas?"),
    ).toBeInTheDocument();
    expect(screen.getByText("Exit speed sets the thrust.")).toBeInTheDocument();
  });

  test("shows the plan badges and the pin and skip controls", () => {
    renderTopic(topic);
    expect(screen.getByLabelText("Plan")).toHaveTextContent("pinned");
    expect(screen.getByLabelText("Plan")).toHaveTextContent("won't fit");
    expect(screen.getByRole("button", { name: "Pin" })).toBeInTheDocument();
  });

  test("shows the Topic state and recall today", () => {
    renderTopic(topic);
    expect(screen.getByLabelText("Topic state: Solid")).toBeInTheDocument();
    expect(screen.getByText("Recall today 91%")).toBeInTheDocument();
  });

  test("links an anchor to its Topic and shows prior knowledge as text", () => {
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
      whyItMatters: "",
      anchors: [],
      readingSections: [],
    });
    expect(screen.queryByRole("link", { name: /Previous/ })).toBeNull();
    expect(
      screen.getByRole("link", { name: /Next: Nozzle flow/ }),
    ).toBeVisible();
  });
});
