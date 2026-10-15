import { describe, expect, test } from "vitest";
import type { KnowledgeMap } from "@/features/knowledge-map/schemas";
import { draftFromSkeleton, draftOf } from "./draft";
import { newChunks, withoutRemoved } from "./update";

const kc = (
  id: string,
  sources: string[],
  origin: "content" | "exercise" | "prior" = "content",
): KnowledgeMap["kcs"][number] =>
  origin === "prior"
    ? {
        id,
        name: id,
        description: ".",
        type: "prior",
        bloom: null,
        bigIdea: null,
        origin,
        sources: [],
      }
    : {
        id,
        name: id,
        description: ".",
        type: "concept",
        bloom: "apply",
        bigIdea: id.startsWith("a") ? "A" : "B",
        origin,
        sources,
      };

const link = (from: string, to: string) => ({
  from,
  to,
  extractionConfidence: 0.5,
});

describe("newChunks", () => {
  test("keeps the chunks no update processed, in order", () => {
    expect(
      newChunks([{ id: "1" }, { id: "2" }, { id: "3" }], ["2"]).map(
        (chunk) => chunk.id,
      ),
    ).toEqual(["1", "3"]);
  });
});

describe("withoutRemoved", () => {
  test("drops unsourced taught KCs, unneeded prior KCs and unsourced Findings", () => {
    const map: KnowledgeMap = {
      bigIdeas: [
        { id: "A", name: "A", description: "." },
        { id: "B", name: "B", description: "." },
      ],
      kcs: [
        kc("a1", ["c1"]),
        kc("b1", []),
        kc("b2", [], "exercise"),
        kc("p-kept", [], "prior"),
        kc("p-gone", [], "prior"),
      ],
      prerequisites: [
        link("p-kept", "a1"),
        link("p-gone", "b1"),
        link("a1", "b1"),
      ],
      semanticLinks: [
        { from: "b2", to: "a1", coreType: "other", label: "uses" },
      ],
      exercises: [
        {
          id: "e1",
          name: "Ex. 1",
          questionChunk: "c2",
          taskType: "compute",
          solutionStatus: "verified",
          solution: null,
          difficulty: 1,
          kcs: ["a1", "b2"],
        },
      ],
      findings: [
        { id: "f1", kind: "solution_mismatch", text: "Kept.", sources: ["c2"] },
        { id: "f2", kind: "solution_mismatch", text: "Gone.", sources: [] },
      ],
    };

    const kept = withoutRemoved(map);

    expect(kept.bigIdeas.map((bigIdea) => bigIdea.id)).toEqual(["A"]);
    expect(kept.kcs.map((k) => k.id)).toEqual(["a1", "p-kept"]);
    expect(kept.prerequisites).toEqual([link("p-kept", "a1")]);
    expect(kept.semanticLinks).toEqual([]);
    expect(kept.exercises[0]?.kcs).toEqual(["a1"]);
    expect(kept.findings.map((finding) => finding.id)).toEqual(["f1"]);
  });
});

describe("draftFromSkeleton on a stored map", () => {
  test("adds new big ideas and candidates and leaves the stored ones", () => {
    const base = draftOf({
      bigIdeas: [{ id: "A", name: "Thrust", description: "Stored." }],
      kcs: [kc("a1", ["c1"]), kc("p1", [], "prior")],
      prerequisites: [],
      semanticLinks: [],
      exercises: [],
      findings: [],
    });

    const draft = draftFromSkeleton(
      {
        bigIdeas: [
          {
            name: "thrust",
            description: "Renamed.",
            kcs: [
              { name: "A1", description: "Changed." },
              { name: "Specific thrust", description: "New." },
            ],
          },
          { name: "Drag", description: "New.", kcs: [] },
        ],
      },
      base,
    );

    expect(draft.bigIdeas).toEqual([
      { id: "A", name: "Thrust", description: "Stored." },
      { id: "b2", name: "Drag", description: "New." },
    ]);
    expect(draft.kcs).toEqual([
      base.kcs[0],
      {
        id: "k2",
        name: "Specific thrust",
        description: "New.",
        bigIdea: "A",
        sources: [],
      },
    ]);
  });
});
