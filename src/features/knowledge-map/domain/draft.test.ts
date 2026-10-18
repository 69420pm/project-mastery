import { describe, expect, test } from "vitest";
import {
  MAX_BIG_IDEAS,
  type KnowledgeMap,
} from "@/features/knowledge-map/schemas";
import {
  applyAssignment,
  draftFromSkeleton,
  draftOf,
  newKcsOf,
  withDraft,
  withoutUnsourced,
  type Draft,
} from "./draft";

const idea = (name: string, kcs: string[] = []) => ({
  name,
  description: `${name}.`,
  kcs: kcs.map((kc) => ({ name: kc, description: `${kc}.` })),
});

const kc = (id: string, bigIdea: string, sources: string[] = []) => ({
  id,
  name: id.toUpperCase(),
  description: ".",
  bigIdea,
  sources,
});

describe("draftFromSkeleton", () => {
  test("gives new big ideas and KCs ids no item of the base has", () => {
    // The base's ids skip numbers, as after an update dropped some.
    const base: Draft = {
      bigIdeas: [
        { id: "b2", name: "Thrust", description: "." },
        { id: "uuid-1", name: "Drag", description: "." },
      ],
      kcs: [kc("k3", "b2"), kc("uuid-2", "b2")],
    };

    const draft = draftFromSkeleton(
      {
        bigIdeas: [
          idea(" thrust ", ["Momentum", "k3"]),
          idea("Lift", ["Angle of attack", "Camber"]),
        ],
      },
      base,
    );

    expect(draft.bigIdeas.map((b) => b.id)).toEqual(["b2", "uuid-1", "b3"]);
    expect(draft.kcs.map((k) => [k.id, k.name, k.bigIdea])).toEqual([
      ["k3", "K3", "b2"],
      ["uuid-2", "UUID-2", "b2"],
      // k3 is taken, so the first new KC is k4; "k3" names the stored KC.
      ["k4", "Momentum", "b2"],
      ["k5", "Angle of attack", "b3"],
      ["k6", "Camber", "b3"],
    ]);
    expect(base.bigIdeas).toHaveLength(2);
    expect(base.kcs).toHaveLength(2);
  });

  test(`adds no big idea past ${MAX_BIG_IDEAS}, but KCs under known ones`, () => {
    const names = Array.from({ length: MAX_BIG_IDEAS + 1 }, (_, i) => `I${i}`);
    const draft = draftFromSkeleton({
      bigIdeas: [
        ...names.map((name) => idea(name, [`${name} kc`])),
        idea("I0", ["Late kc"]),
      ],
    });

    expect(draft.bigIdeas).toHaveLength(MAX_BIG_IDEAS);
    expect(draft.bigIdeas.at(-1)?.name).toBe(`I${MAX_BIG_IDEAS - 1}`);
    expect(draft.kcs.map((k) => k.name)).not.toContain(`I${MAX_BIG_IDEAS} kc`);
    expect(draft.kcs.at(-1)).toMatchObject({ name: "Late kc", bigIdea: "b1" });
  });
});

describe("applyAssignment", () => {
  const draft: Draft = {
    bigIdeas: [{ id: "b1", name: "Thrust", description: "." }],
    kcs: [kc("k1", "b1", ["c1"]), kc("k2", "b1")],
  };

  test("merges sources without repeats and leaves the input draft as it was", () => {
    const next = applyAssignment(draft, {
      taught: { c1: ["k1"], c2: ["k1", "k2", "unknown"] },
      newKcs: [
        // Named like k2, so its chunks join k2.
        { name: " k2", description: ".", bigIdea: "b1", chunkIds: ["c3"] },
        {
          name: "Momentum",
          description: ".",
          bigIdea: "b1",
          chunkIds: ["c4", "c4"],
        },
        { name: "Lost", description: ".", bigIdea: "b9", chunkIds: ["c5"] },
      ],
    });

    expect(next.kcs.map((k) => [k.id, k.sources])).toEqual([
      ["k1", ["c1", "c2"]],
      ["k2", ["c2", "c3"]],
      ["k3", ["c4"]],
    ]);
    expect(draft.kcs.map((k) => k.sources)).toEqual([["c1"], []]);
  });

  test("drops unsourced KCs and the big ideas they leave empty", () => {
    const next = withoutUnsourced({
      bigIdeas: [
        ...draft.bigIdeas,
        { id: "b2", name: "Lift", description: "." },
      ],
      kcs: [...draft.kcs, kc("k3", "b2")],
    });
    expect(next.kcs.map((k) => k.id)).toEqual(["k1"]);
    expect(next.bigIdeas.map((b) => b.id)).toEqual(["b1"]);
  });
});

describe("draftOf and withDraft", () => {
  const map: KnowledgeMap = {
    bigIdeas: [{ id: "B", name: "Thrust", description: "." }],
    kcs: [
      {
        ...kc("K", "B", ["c1"]),
        type: "concept",
        bloom: "apply",
        origin: "content",
      },
      {
        ...kc("P", "B"),
        type: "prior",
        bloom: null,
        bigIdea: null,
        origin: "prior",
      },
    ],
    prerequisites: [{ from: "P", to: "K", extractionConfidence: 1 }],
    semanticLinks: [],
    exercises: [],
    findings: [],
  };

  test("drafts the taught KCs and puts new sources and filled KCs back", () => {
    const draft = draftOf(map);
    expect(draft.kcs.map((k) => k.id)).toEqual(["K"]);

    const next = applyAssignment(draft, {
      taught: { c2: ["K"] },
      newKcs: [
        { name: "New", description: ".", bigIdea: "B", chunkIds: ["c3"] },
      ],
    });
    expect(newKcsOf(map, next).map((k) => k.id)).toEqual(["k2"]);
    const filled = withDraft(map, next, {
      k2: { type: "fact", bloom: "remember", description: "Filled." },
    });
    expect(filled.kcs.map((k) => [k.id, k.sources, k.description])).toEqual([
      ["K", ["c1", "c2"], "."],
      ["P", [], "."],
      ["k2", ["c3"], "Filled."],
    ]);
    expect(() => withDraft(map, next, {})).toThrow("KC k2 was not filled.");
  });
});
