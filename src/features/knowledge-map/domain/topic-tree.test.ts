import { describe, expect, test } from "vitest";
import {
  planTopicTree,
  storedAsProposed,
  topicLineage,
  type ProposedTopic,
  type TreeKc,
} from "./topic-tree";

const chapters = ["spaces", "subspaces", "bases", "maps", "sheet"].map(
  (id) => ({ id, title: `Title ${id}` }),
);

const proposed = (
  level: number,
  name: string,
  chapterIds: string[],
  continues: string | null = null,
): ProposedTopic => ({
  level,
  name,
  chapterIds,
  centralQuestion: chapterIds.length > 0 ? `Why ${name}?` : "",
  continues,
});

const kc = (
  id: string,
  chapterId: string | null,
  tests?: string[],
): TreeKc => ({
  id,
  chapterId,
  ...(tests && { tests }),
});

const plan = (topics: ProposedTopic[], kcs: TreeKc[], stored: string[] = []) =>
  planTopicTree({
    proposed: topics,
    chapters,
    kcs,
    storedIds: new Set(stored),
  });

describe("planTopicTree", () => {
  test("nests Topics by level, a parent holding KCs of its own beside its children", () => {
    const tree = plan(
      [
        proposed(1, "Spaces", ["spaces"]),
        proposed(2, "Subspaces", ["subspaces"]),
        proposed(2, "Bases", ["bases"]),
        proposed(1, "Maps", ["maps"]),
      ],
      [
        kc("k1", "spaces"),
        kc("k2", "subspaces"),
        kc("k3", "bases"),
        kc("k4", "maps"),
      ],
    );
    expect(tree.map((t) => [t.name, t.parent, t.kcs])).toEqual([
      ["Spaces", null, ["k1"]],
      ["Subspaces", 0, ["k2"]],
      ["Bases", 0, ["k3"]],
      ["Maps", null, ["k4"]],
    ]);
    expect(tree[0]).toMatchObject({
      centralQuestion: "Why Spaces?",
      chapterIds: ["spaces"],
    });
  });

  test("gives a Chapter to the first Topic naming it; one left out becomes a top-level Topic by its title", () => {
    const tree = plan(
      [proposed(1, "A", ["spaces"]), proposed(1, "B", ["spaces", "bases"])],
      [kc("k1", "spaces"), kc("k2", "bases"), kc("k3", "maps")],
    );
    expect(tree.map((t) => [t.name, t.chapterIds, t.kcs])).toEqual([
      ["A", ["spaces"], ["k1"]],
      ["B", ["bases"], ["k2"]],
      ["Title maps", ["maps"], ["k3"]],
    ]);
    expect(tree[2]!.centralQuestion).toBe("Title maps");
  });

  test("drops Topics without KCs or children, from the leaves up, and keeps a parent without KCs of its own", () => {
    const tree = plan(
      [
        proposed(1, "Empty parent", []),
        proposed(2, "Empty child", ["maps"]),
        proposed(1, "Holder", []),
        proposed(2, "Spaces", ["spaces"]),
      ],
      [kc("k1", "spaces")],
    );
    expect(tree).toEqual([
      {
        id: null,
        parent: null,
        name: "Holder",
        centralQuestion: null,
        chapterIds: [],
        kcs: [],
      },
      expect.objectContaining({ name: "Spaces", parent: 0, kcs: ["k1"] }),
    ]);
  });

  test("puts a KC from the exercise call in the Topic holding most of the KCs it is tested with", () => {
    const tree = plan(
      [proposed(1, "Spaces", ["spaces"]), proposed(1, "Bases", ["bases"])],
      [
        kc("k1", "spaces"),
        kc("k2", "bases"),
        kc("k3", "bases"),
        kc("x1", "sheet", ["k1", "k2", "k3"]),
        // Tested only with another exercise KC: placed by its own Chapter.
        kc("x2", "sheet", ["x1"]),
      ],
    );
    expect(tree.map((t) => [t.name, t.kcs])).toEqual([
      ["Spaces", ["k1"]],
      ["Bases", ["k2", "k3", "x1"]],
      ["Title sheet", ["x2"]],
    ]);
  });

  test("keeps a continued stored id once, and only a stored one", () => {
    const tree = plan(
      [
        proposed(1, "A", ["spaces"], "t1"),
        proposed(1, "B", ["bases"], "t1"),
        proposed(1, "C", ["maps"], "unknown"),
      ],
      [kc("k1", "spaces"), kc("k2", "bases"), kc("k3", "maps")],
      ["t1"],
    );
    expect(tree.map((t) => t.id)).toEqual(["t1", null, null]);
  });

  test("a stored tree proposed again plans the same Topics", () => {
    const stored = [
      {
        id: "t1",
        parentId: null,
        name: "Spaces",
        centralQuestion: null,
        chapterIds: [],
      },
      {
        id: "t2",
        parentId: "t1",
        name: "Bases",
        centralQuestion: "Why?",
        chapterIds: ["bases"],
      },
    ];
    const tree = plan(
      storedAsProposed(stored),
      [kc("k1", "bases")],
      ["t1", "t2"],
    );
    expect(tree.map((t) => [t.id, t.parent, t.centralQuestion])).toEqual([
      ["t1", null, null],
      ["t2", 0, "Why?"],
    ]);
  });
});

test("a Topic's lineage runs from it up to the top", () => {
  const parents = new Map([
    ["leaf", "mid"],
    ["mid", "top"],
    ["top", null],
  ]);
  expect(topicLineage("leaf", parents)).toEqual(["leaf", "mid", "top"]);
  expect(topicLineage("top", parents)).toEqual(["top"]);
});
