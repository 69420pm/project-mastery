import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  courseMapSchema,
  knowledgeMapSchema,
  MAX_BIG_IDEAS,
} from "@/features/knowledge-map/schemas";

const GOLD = path.join(process.cwd(), "evals/gold/jet-engines");
const readJson = (file: string): unknown =>
  JSON.parse(readFileSync(path.join(GOLD, file), "utf8"));

describe("the jet-engines gold map", () => {
  const chunks = z
    .array(z.object({ position: z.number(), label: z.string() }))
    .parse(readJson("chunks.json"));
  const gold = courseMapSchema(z.int().nonnegative()).parse(
    readJson("gold.json"),
  );

  it("parses with the course model and stays within the big-idea limit", () => {
    expect(gold.bigIdeas.length).toBeLessThanOrEqual(MAX_BIG_IDEAS);
    expect(gold.kcs.filter((kc) => kc.type === "prior")).toHaveLength(5);
  });

  it("grounds every taught KC in chunks of chunks.json", () => {
    const positions = new Set(chunks.map((c) => c.position));
    for (const kc of gold.kcs.filter((k) => k.type !== "prior")) {
      expect(kc.sources.length, kc.id).toBeGreaterThan(0);
      for (const source of kc.sources) expect(positions).toContain(source);
    }
  });
});

describe("knowledgeMapSchema", () => {
  const kc = {
    id: "k1",
    name: "Thrust",
    description: "Net forward force.",
    type: "fact",
    bloom: "remember",
    bigIdea: "b1",
    origin: "content",
    sources: [],
  };
  const map = {
    bigIdeas: [{ id: "b1", name: "Thrust", description: "Momentum." }],
    kcs: [kc],
    prerequisites: [],
    semanticLinks: [],
  };

  it("rejects prior knowledge with a Bloom level or a big idea", () => {
    const prior = { ...kc, type: "prior", origin: "prior" };
    expect(knowledgeMapSchema.safeParse({ ...map, kcs: [prior] }).success).toBe(
      false,
    );
  });

  it("rejects links to unknown KCs and self links", () => {
    for (const to of ["k2", "k1"]) {
      const link = { from: "k1", to, extractionConfidence: 0.5 };
      expect(
        knowledgeMapSchema.safeParse({ ...map, prerequisites: [link] }).success,
      ).toBe(false);
    }
  });
});
