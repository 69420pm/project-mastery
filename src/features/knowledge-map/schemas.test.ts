import { describe, expect, it } from "vitest";
import { knowledgeMapSchema } from "@/features/knowledge-map/schemas";

describe("knowledgeMapSchema", () => {
  const ids = {
    bigIdea: "00000000-0000-4000-8000-000000000001",
    kc: "00000000-0000-4000-8000-000000000002",
    other: "00000000-0000-4000-8000-000000000003",
  };
  const map = {
    bigIdeas: [{ id: ids.bigIdea, name: "Thrust", description: "Momentum." }],
    kcs: [
      {
        id: ids.kc,
        name: "Thrust",
        description: "Net forward force.",
        type: "fact",
        bigIdea: ids.bigIdea,
        origin: "content",
        sources: [],
      },
    ],
    prerequisites: [],
    exercises: [],
  };

  it("parses a map whose references resolve", () => {
    expect(knowledgeMapSchema.safeParse(map).success).toBe(true);
  });

  it("rejects Prerequisites to unknown KCs and self links", () => {
    for (const to of [ids.other, ids.kc]) {
      const link = { from: ids.kc, to };
      expect(
        knowledgeMapSchema.safeParse({ ...map, prerequisites: [link] }).success,
      ).toBe(false);
    }
  });
});
