import { describe, expect, test } from "vitest";
import { selectCandidates, type CandidateMap } from "./candidates";

const kc = (id: string, bigIdea: string | null) => ({
  id,
  name: `KC ${id}`,
  type: bigIdea === null ? "prior" : "concept",
  bigIdea,
});

const map: CandidateMap = {
  bigIdeas: [
    { id: "B1", name: "Thrust" },
    { id: "B2", name: "Cycles" },
  ],
  kcs: [
    kc("prior", null),
    kc("a", "B1"),
    kc("b", "B1"),
    kc("c", "B2"),
    kc("d", "B2"),
    kc("e", "B2"),
  ],
  prerequisites: [
    { from: "prior", to: "a" },
    { from: "a", to: "b" },
    { from: "prior", to: "e" },
  ],
};

const ids = (groups: ReturnType<typeof selectCandidates>) =>
  groups.map(({ bigIdea, kcs }) => [bigIdea, kcs.map(({ id }) => id)]);

describe("selectCandidates", () => {
  test("ranks by Priority, groups by big idea and leaves out KCs that are prior, at 0 or not ready", () => {
    const groups = selectCandidates(map, { a: 0.4, b: 0.9, c: 0, d: 0.8 });

    expect(ids(groups)).toEqual([
      ["Cycles", ["d", "e"]],
      ["Thrust", ["a"]],
    ]);
  });

  test("puts KCs without a Priority last, in map order, and lists their anchors", () => {
    const groups = selectCandidates(map, {});

    expect(ids(groups)).toEqual([
      ["Thrust", ["a"]],
      ["Cycles", ["c", "d", "e"]],
    ]);
    expect(groups[0]!.kcs[0]!.anchors).toEqual([
      { id: "prior", name: "KC prior" },
    ]);
  });

  test("keeps at most 10", () => {
    const many: CandidateMap = {
      bigIdeas: [{ id: "B", name: "All" }],
      kcs: Array.from({ length: 12 }, (_, i) => kc(`k${i}`, "B")),
      prerequisites: [],
    };

    expect(selectCandidates(many, {})[0]!.kcs).toHaveLength(10);
  });
});
