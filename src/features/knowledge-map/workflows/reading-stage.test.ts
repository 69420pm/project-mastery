// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useMockModels } from "@/lib/ai/testing";
import { markAdminClient } from "@/lib/supabase/admin-brand";
import type { Supabase } from "@/lib/supabase/types";
import {
  createMapDb,
  mapModel,
  seedBuild,
  seedMaterial,
} from "./build-testing";

vi.mock("server-only", () => ({}));

const COURSE = "aaaaaaaa-c000-4000-8000-000000000005";

let db = createMapDb(COURSE);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));

const { buildKnowledgeMap } = await import("./build-knowledge-map");

beforeEach(() => {
  db = createMapDb(COURSE);
});

/** Runs one update to its end and returns the build's status. */
async function update() {
  db.tables.knowledge_map_builds = [];
  seedBuild(db, COURSE);
  await buildKnowledgeMap(COURSE);
  return db.tables.knowledge_map_builds[0]?.status;
}

/** Each stored section as its pages, chunk count, mode and reason. */
function stored() {
  return db.tables.reading_sections.map((row) => ({
    id: row.id,
    pages: [row.page_from, row.page_to],
    chunks: (row.chunk_ids as string[]).length,
    mode: row.mode,
    reason: row.reason,
  }));
}

/** One big idea with a KC per page of Lecture 1, five pages long. */
function course() {
  seedMaterial(
    db,
    COURSE,
    "Lecture 1",
    "parsed",
    [1, 2, 3, 4, 5].map((page) => ["content", `Page ${page}.`]),
  );
  return mapModel({
    skeleton: () => ({
      bigIdeas: [
        {
          name: "Propulsion",
          description: "Making thrust.",
          kcs: ["Thrust", "Drag"].map((name) => ({ name, description: "." })),
        },
      ],
    }),
    assign: () => ({
      taught: { c1: ["k1"], c2: ["k1"], c3: ["k1"], c4: ["k2"], c5: ["k2"] },
      newKcs: [],
    }),
  });
}

describe("the Reading stage", () => {
  test("a build stores the Topic's sections as original and ends the build, and a rerun keeps them with their modes and makes no call", async () => {
    const { models, sent } = course();
    useMockModels(models);

    expect(await update()).toBe("built");
    const first = stored();
    expect(first).toEqual([
      expect.objectContaining({
        pages: [1, 3],
        chunks: 3,
        mode: "original",
        reason: "Not judged yet.",
      }),
      expect.objectContaining({ pages: [4, 5], chunks: 2 }),
    ]);

    // A later slice's judgement stays: the section keeps its row and mode.
    Object.assign(db.tables.reading_sections[1] ?? {}, {
      mode: "study_text",
      reason: "Dense.",
      study_text: "Text. [pp. 4–5]",
    });
    const calls = sent.length;
    expect(await update()).toBe("built");
    expect(sent).toHaveLength(calls);
    expect(stored()).toEqual([
      first[0],
      { ...first[1], mode: "study_text", reason: "Dense." },
    ]);
    expect(db.tables.reading_sections[1]?.study_text).toBe("Text. [pp. 4–5]");
  });

  test("a stored section the cut no longer matches is replaced by a new original one", async () => {
    const { models } = course();
    useMockModels(models);
    expect(await update()).toBe("built");
    const [first, second] = stored();

    // The first section was stored with a chunk fewer than the cut has now.
    const row = db.tables.reading_sections[0];
    if (row) {
      row.chunk_ids = (row.chunk_ids as string[]).slice(1);
      row.mode = "study_text";
    }
    expect(await update()).toBe("built");

    const after = stored();
    expect(after).toHaveLength(2);
    expect(after[0]?.id).not.toBe(first?.id);
    expect(after[0]).toEqual(
      expect.objectContaining({ mode: "original", chunks: 3 }),
    );
    expect(after[1]).toEqual(second);
  });
});
