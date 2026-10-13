import { describe, expect, it } from "vitest";
import {
  breakCycles,
  checkMap,
  withLinks,
  withoutRedundant,
  type Prerequisite,
} from "@/features/knowledge-map/domain/links";
import type { KnowledgeMap } from "@/features/knowledge-map/schemas";

const edge = (from: string, to: string, confidence = 0.9): Prerequisite => ({
  from,
  to,
  extractionConfidence: confidence,
});

const pairs = (edges: Prerequisite[]) => edges.map((e) => `${e.from}→${e.to}`);

describe("breakCycles", () => {
  it("drops the lowest-confidence edge of each cycle until none is left", () => {
    const { kept, dropped } = breakCycles([
      edge("a", "b", 0.9),
      edge("b", "c", 0.4),
      edge("c", "a", 0.8),
      edge("c", "d", 0.9),
      edge("d", "c", 0.5),
    ]);
    expect(pairs(dropped).toSorted()).toEqual(["b→c", "d→c"]);
    expect(pairs(kept)).toEqual(["a→b", "c→a", "c→d"]);
  });

  it("keeps an acyclic graph whole", () => {
    const edges = [edge("a", "b"), edge("a", "c"), edge("b", "c")];
    expect(breakCycles(edges)).toEqual({ kept: edges, dropped: [] });
  });
});

describe("withoutRedundant", () => {
  it("drops A→C when A→B→C exists, however long the path", () => {
    const kept = withoutRedundant([
      edge("a", "b"),
      edge("b", "c"),
      edge("c", "d"),
      edge("a", "c"),
      edge("a", "d"),
      edge("x", "d"),
    ]);
    expect(pairs(kept)).toEqual(["a→b", "b→c", "c→d", "x→d"]);
  });
});

const map: KnowledgeMap = {
  bigIdeas: [{ id: "b1", name: "Cycle", description: "The cycle." }],
  kcs: ["Pressure ratio", "Turbine work", "Thrust"].map((name, i) => ({
    id: `k${i + 1}`,
    name,
    description: name,
    type: "concept",
    bloom: "apply",
    bigIdea: "b1",
    origin: "content",
    sources: i === 2 ? [] : [`chunk-${i + 1}`],
  })),
  prerequisites: [],
  semanticLinks: [],
};

describe("withLinks", () => {
  it("adds prior KCs, cleans the links and breaks cycles", () => {
    const linked = withLinks(map, {
      prerequisites: [
        edge("k1", "k2", 0.6),
        edge("k1", "k2", 0.9),
        edge("k2", "k1", 0.3),
        edge("k3", "k3"),
      ],
      semanticLinks: [
        { from: "k1", to: "k2", coreType: "causes", label: "sets" },
        { from: "k1", to: "k2", coreType: "causes", label: "sets again" },
        { from: "k2", to: "k2", coreType: "other", label: "self" },
      ],
      priorKcs: [
        {
          name: "Ideal gas law",
          description: "pv = RT",
          requiredBy: ["k1"],
          extractionConfidence: 0.7,
        },
        // Named like a KC of the map: that KC is the prerequisite.
        {
          name: "pressure ratio",
          description: "Taught already",
          requiredBy: ["k2"],
          extractionConfidence: 0.95,
        },
      ],
    });
    expect(linked.map.kcs.at(-1)).toMatchObject({
      id: "p4",
      name: "Ideal gas law",
      type: "prior",
      origin: "prior",
    });
    expect(linked.map.kcs).toHaveLength(4);
    expect(linked.map.prerequisites).toEqual([
      edge("k1", "k2", 0.95),
      edge("p4", "k1", 0.7),
    ]);
    expect(linked.map.semanticLinks.map((l) => l.label)).toEqual(["sets"]);
    expect(linked.droppedCycleEdges).toEqual([edge("k2", "k1", 0.3)]);
  });
});

describe("checkMap", () => {
  it("lists uncovered chunks, ungrounded and orphan KCs and dropped edges", () => {
    const report = checkMap(
      { ...map, prerequisites: [edge("k1", "k2")] },
      [
        { id: "chunk-1", label: "content" },
        { id: "chunk-9", label: "definition" },
        { id: "chunk-10", label: "exercise" },
      ],
      [edge("k2", "k1", 0.3)],
    );
    expect(report).toEqual({
      uncoveredChunkIds: ["chunk-9"],
      ungroundedKcs: ["Thrust"],
      orphanKcs: ["Thrust"],
      droppedCycleEdges: [
        {
          from: "Turbine work",
          to: "Pressure ratio",
          extractionConfidence: 0.3,
        },
      ],
    });
  });
});
