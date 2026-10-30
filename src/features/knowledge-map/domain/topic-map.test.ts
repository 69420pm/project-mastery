import { describe, expect, test } from "vitest";
import type { KcView, KnowledgeMapView } from "@/features/knowledge-map/types";
import { restrictMapToTopic } from "./topic-map";

const kc = (id: string): KcView => ({
  id,
  name: id,
  description: "",
  type: "concept",
  origin: "content",
  sources: [],
});
const exercise = (id: string, kcs: string[]) => ({
  id,
  name: id,
  kcs,
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
    { id: "b3", name: "B3", description: "", kcs: [kc("p")] },
  ],
  prerequisites: [
    { from: "p", to: "c" },
    { from: "b", to: "c" },
    { from: "a", to: "b" },
    { from: "c", to: "d" },
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

  test("keeps the Topic's KCs and its anchors in their Big ideas", () => {
    expect(view.bigIdeas.map((b) => [b.id, b.kcs.map((k) => k.id)])).toEqual([
      ["b1", ["b"]],
      ["b2", ["c"]],
      ["b3", ["p"]],
    ]);
  });

  test("keeps the Prerequisites among the shown KCs", () => {
    expect(view.prerequisites.map((l) => l.from + l.to)).toEqual(["pc", "bc"]);
  });

  test("keeps the Exercises that test a Topic KC, listing the shown KCs only", () => {
    expect(view.exercises.map((e) => [e.id, e.kcs])).toEqual([
      ["e1", ["c"]],
      ["e3", ["c", "b"]],
    ]);
  });
});
