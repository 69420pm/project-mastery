import { describe, expect, test } from "vitest";
import type { KnowledgeMap } from "@/features/knowledge-map/schemas";
import {
  checkTopicProposals,
  teachingOrder,
  topicsOnMap,
  unplacedKcs,
  withTopicProposals,
  withTopicRules,
  type Topic,
} from "./topics";

const kc = (
  id: string,
  bigIdea: string | null,
  sources: string[] = [],
): KnowledgeMap["kcs"][number] =>
  bigIdea === null
    ? {
        id,
        name: id,
        description: ".",
        type: "prior",
        bloom: null,
        bigIdea: null,
        origin: "prior",
        sources: [],
      }
    : {
        id,
        name: id,
        description: ".",
        type: "concept",
        bloom: "apply",
        bigIdea,
        origin: "content",
        sources,
      };

const prerequisite = (from: string, to: string) => ({
  from,
  to,
  extractionConfidence: 0.5,
});

const topic = (id: string | null, kcs: string[], bigIdea = "A"): Topic => ({
  id,
  bigIdea,
  name: `Topic ${id}`,
  centralQuestion: `Why ${id}?`,
  whyItMatters: ".",
  kcs,
});

const proposal = (id: string, kcs: string[]) => ({
  id,
  name: `Proposed ${id}`,
  centralQuestion: `Proposed ${id}?`,
  whyItMatters: ".",
  kcs,
});

const bigIdeas = ["A", "B"].map((id) => ({ id, name: id, description: "." }));

describe("checkTopicProposals", () => {
  const sent = ["k1", "k2", "k3"];
  test("passes when every new KC appears once, placed KCs in any number", () => {
    expect(() =>
      checkTopicProposals(
        [proposal("t1", ["k1", "k3"]), proposal("n", ["k2", "k3"])],
        ["k1", "k2"],
        sent,
      ),
    ).not.toThrow();
  });

  test.each([
    ["missing", [proposal("t1", ["k1"])]],
    ["duplicate", [proposal("t1", ["k1", "k2"]), proposal("n", ["k2"])]],
    ["unknown", [proposal("t1", ["k1", "k2", "k9"])]],
  ])("throws for a %s KC", (_, proposals) => {
    expect(() => checkTopicProposals(proposals, ["k1", "k2"], sent)).toThrow();
  });
});

describe("stored Topics on an update", () => {
  test("removed, moved and prior KCs leave their Topic and moved ones are new", () => {
    const map = {
      bigIdeas,
      kcs: [kc("k1", "A"), kc("k3", "B"), kc("k4", null), kc("k5", "A")],
    };
    const topics = topicsOnMap(map, [topic("t1", ["k1", "k2", "k3", "k4"])]);
    expect(topics).toEqual([topic("t1", ["k1"])]);
    expect(unplacedKcs(map, topics)).toEqual(
      new Map([
        ["A", ["k5"]],
        ["B", ["k3"]],
      ]),
    );
  });

  test("placement overrides the model: placed KCs and stored names stay", () => {
    const stored = [topic("t1", ["k1", "k2"]), topic("t2", ["k3", "k4"])];
    const result = withTopicProposals(
      stored,
      "A",
      [
        // The model moves k3 and renames t1; only k5's placement counts.
        { ...proposal("t1", ["k3", "k1", "k5"]), name: "Renamed" },
        proposal("fresh", ["k6", "k2", "k7"]),
        proposal("empty", ["k4"]),
      ],
      ["k5", "k6", "k7"],
    );
    expect(result).toEqual([
      topic("t1", ["k1", "k2", "k5"]),
      topic("t2", ["k3", "k4"]),
      { ...proposal("fresh", ["k6", "k7"]), id: null, bigIdea: "A" },
    ]);
  });
});

describe("withTopicRules", () => {
  const map = (
    kcs: KnowledgeMap["kcs"],
    prerequisites: KnowledgeMap["prerequisites"] = [],
    semanticLinks: KnowledgeMap["semanticLinks"] = [],
  ) => ({ kcs, prerequisites, semanticLinks });
  const chunks = ["c1", "c2", "c3", "c4", "c5"];
  const ids = (topics: Topic[]) => topics.map((t) => [t.id, t.kcs]);

  test("merges a small Topic into the one sharing most links, keeping its id", () => {
    const result = withTopicRules(
      map(
        [
          kc("k1", "A", ["c1"]),
          kc("k2", "A", ["c1"]),
          kc("k3", "A", ["c5"]),
        ].concat([kc("k4", "A", ["c5"]), kc("k5", "A", ["c2"])]),
        [],
        [{ from: "k5", to: "k3", coreType: "other", label: "near" }],
      ),
      [
        topic("t1", ["k1", "k2"]),
        topic("t2", ["k3", "k4"]),
        topic(null, ["k5"]),
      ],
      chunks,
    );
    expect(ids(result)).toEqual([
      ["t1", ["k1", "k2"]],
      ["t2", ["k3", "k4", "k5"]],
    ]);
  });

  test("a tie goes to the nearest first source; an only Topic stays; an empty one goes", () => {
    const result = withTopicRules(
      map([
        kc("k1", "A", ["c1"]),
        kc("k2", "A", ["c1"]),
        kc("k3", "A", ["c5"]),
        kc("k4", "A", ["c5"]),
        kc("k5", "A", ["c4"]),
        kc("k6", "B", ["c3"]),
      ]),
      [
        topic("t1", ["k1", "k2"]),
        topic("t2", ["k3", "k4"]),
        topic(null, ["k5"]),
        topic("t3", ["k6"], "B"),
        topic("t4", [], "B"),
      ],
      chunks,
    );
    expect(ids(result)).toEqual([
      ["t1", ["k1", "k2"]],
      ["t3", ["k6"]],
      ["t2", ["k3", "k4", "k5"]],
    ]);
  });

  test("teaching order puts in-Topic Prerequisites first, else keeps the model's", () => {
    expect(
      teachingOrder(
        ["k1", "k2", "k3", "k4"],
        [prerequisite("k3", "k1"), prerequisite("k9", "k2")],
      ),
    ).toEqual(["k2", "k3", "k1", "k4"]);
  });

  test("Topic order follows Prerequisites, then first source, and breaks a cycle at the earliest", () => {
    const result = withTopicRules(
      map(
        [
          kc("a1", "A", ["c1"]),
          kc("a2", "A", ["c1"]),
          kc("b1", "A", ["c2"]),
          kc("b2", "A", ["c2"]),
          kc("c1", "A", ["c3"]),
          kc("c2", "A", ["c3"]),
          kc("d1", "B"),
          kc("d2", "B"),
        ],
        [
          // a needs c, c needs b, and b and d need each other: the cycle
          // breaks at b, the earlier; d, without a source, comes last.
          prerequisite("c1", "a1"),
          prerequisite("b1", "c2"),
          prerequisite("d1", "b1"),
          prerequisite("b2", "d2"),
        ],
      ),
      [
        topic("a", ["a1", "a2"]),
        topic("b", ["b1", "b2"]),
        topic("c", ["c1", "c2"]),
        topic("d", ["d1", "d2"], "B"),
      ],
      chunks,
    );
    expect(result.map((t) => t.id)).toEqual(["b", "c", "a", "d"]);
  });
});
