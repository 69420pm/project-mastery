import { describe, expect, test } from "vitest";
import type { KcView, KnowledgeMapView } from "@/features/knowledge-map/types";
import { restrictMapToTopic } from "./topic-map";

const kc = (id: string, origin: KcView["origin"] = "content"): KcView => ({
  id,
  name: id,
  description: "",
  type: "concept",
  bloom: null,
  origin,
  sources: [],
});
const exercise = (id: string, kcs: string[]) => ({
  id,
  name: id,
  taskType: "calculate",
  kcs,
  solutionStatus: "given" as const,
  difficulty: 1 as const,
  question: null,
  solution: null,
});

const map: KnowledgeMapView = {
  courseId: "c",
  build: null,
  bigIdeas: [
    { id: "b1", name: "B1", description: "", kcs: [kc("a"), kc("b")] },
    { id: "b2", name: "B2", description: "", kcs: [kc("c"), kc("d")] },
  ],
  priorKnowledge: [kc("p", "prior")],
  prerequisites: [
    { from: "p", to: "c", confidence: 1 },
    { from: "b", to: "c", confidence: 1 },
    { from: "a", to: "b", confidence: 1 },
    { from: "c", to: "d", confidence: 1 },
  ],
  semanticLinks: [
    { from: "b", to: "c", coreType: "causes", label: "x" },
    { from: "c", to: "d", coreType: "causes", label: "y" },
  ],
  exercises: [
    exercise("e1", ["c", "d"]),
    exercise("e2", ["d"]),
    exercise("e3", ["c", "b"]),
  ],
  checkReport: null,
  canBuild: true,
};

describe("restrictMapToTopic", () => {
  const topic = {
    kcs: [{ id: "c" }],
    anchors: [{ id: "p" }, { id: "b" }],
  };
  const view = restrictMapToTopic(map, topic);

  test("keeps the Topic's KCs in their Big idea and puts anchors across Big ideas ungrouped", () => {
    expect(view.bigIdeas.map((b) => [b.id, b.kcs.map((k) => k.id)])).toEqual([
      ["b2", ["c"]],
    ]);
    expect(view.priorKnowledge.map((k) => k.id).sort()).toEqual(["b", "p"]);
  });

  test("keeps the links among the shown KCs", () => {
    expect(view.prerequisites.map((l) => l.from + l.to)).toEqual(["pc", "bc"]);
    expect(view.semanticLinks.map((l) => l.from + l.to)).toEqual(["bc"]);
  });

  test("keeps the Exercises that test a Topic KC, listing the shown KCs only", () => {
    expect(view.exercises.map((e) => [e.id, e.kcs])).toEqual([
      ["e1", ["c"]],
      ["e3", ["c", "b"]],
    ]);
  });
});
