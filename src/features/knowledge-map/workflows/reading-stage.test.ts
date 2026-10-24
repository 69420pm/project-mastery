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
  STUDENT,
  type Sent,
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
  vi.unstubAllEnvs();
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

const isReadingCall = (input: Sent) => "section" in input;

/**
 * One big idea with a KC per page of Lecture 1, five pages long. `reading`
 * answers the reading calls; `topic` runs at the topic call.
 */
function course(reading?: (input: Sent) => unknown, topic?: () => void) {
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
    reading,
    topic: topic && (() => void topic()),
  });
}

describe("the Reading stage", () => {
  test("a first build judges each section and writes the texts of the non-original ones, while the build is still building", async () => {
    const statuses: unknown[] = [];
    const { models, sent } = course((input) => {
      statuses.push(db.tables.knowledge_map_builds[0]?.status);
      const { pageFrom } = input.section as { pageFrom: number };
      if (!("mode" in input)) {
        return pageFrom === 1
          ? { mode: "annotated", reason: "A step is missing." }
          : { mode: "study_text", reason: "Terse slides." };
      }
      return input.mode === "annotated"
        ? { notes: [{ page: 2, note: "The skipped step." }] }
        : { text: "Thrust. [p. 4]\n\nDrag. [pp. 4–5]" };
    });
    useMockModels(models);

    expect(await update()).toBe("built");
    const calls = sent.filter(isReadingCall);
    expect(calls).toHaveLength(4);
    expect(calls[0]).toMatchObject({
      topic: { name: "New topic", centralQuestion: "What is new?" },
      section: { pageFrom: 1, pageTo: 3 },
      kcs: [{ name: "Thrust" }],
    });
    expect(calls[0]?.chunks).toEqual([
      expect.objectContaining({ pageFrom: 1, markdown: "Page 1." }),
      expect.objectContaining({ pageFrom: 2 }),
      expect.objectContaining({ pageFrom: 3 }),
    ]);
    expect(statuses).toEqual(["building", "building", "building", "building"]);
    expect(stored()).toEqual([
      expect.objectContaining({ pages: [1, 3], mode: "annotated" }),
      expect.objectContaining({ pages: [4, 5], mode: "study_text" }),
    ]);
    expect(db.tables.reading_sections[0]).toMatchObject({
      reason: "A step is missing.",
      annotations: [{ page: 2, note: "The skipped step." }],
      study_text: null,
    });
    expect(db.tables.reading_sections[1]).toMatchObject({
      annotations: null,
      study_text: "Thrust. [p. 4]\n\nDrag. [pp. 4–5]",
    });
    expect(
      db.tables.ai_usage.filter((row) => row.task === "reading"),
    ).toHaveLength(4);
  });

  test("a failed mode or writing call leaves its section original with the reason", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { models } = course((input) => {
      const { pageFrom } = input.section as { pageFrom: number };
      if (!("mode" in input)) {
        return pageFrom === 1
          ? { mode: "unknown" }
          : { mode: "study_text", reason: "Terse." };
      }
      // Cites a page outside the section, which fails the check.
      return { text: "Thrust. [p. 1]" };
    });
    useMockModels(models);

    expect(await update()).toBe("built");
    expect(stored()).toEqual([
      expect.objectContaining({
        mode: "original",
        reason: "The mode call failed.",
      }),
      expect.objectContaining({
        mode: "original",
        reason: "The writing call failed.",
      }),
    ]);
    expect(db.tables.reading_sections[1]?.study_text).toBeNull();
  });

  test("a reached Daily limit fails the build with its reason and keeps the Topics", async () => {
    const { models, sent } = course(undefined, () => {
      // The topic call spends past the limit, so the reading calls stop.
      vi.stubEnv("AI_DAILY_LIMIT_USD", "1");
      db.tables.ai_usage.push({
        owner: STUDENT,
        task: "chat",
        cost_usd: 5,
        created_at: new Date().toISOString(),
      });
    });
    useMockModels(models);

    expect(await update()).toBe("failed");
    expect(db.tables.knowledge_map_builds[0]?.failure_reason).toBe(
      "Daily limit reached",
    );
    expect(sent.filter(isReadingCall)).toHaveLength(0);
    expect(db.tables.topics).toHaveLength(1);
    expect(db.tables.reading_sections).toEqual([]);
  });

  test("a Daily limit reached mid-stage stores the judged sections, and the next build judges only the rest", async () => {
    let spent = false;
    const { models, sent } = course((input) => {
      const { pageFrom } = input.section as { pageFrom: number };
      if (pageFrom === 1) return { mode: "original", reason: "Reads well." };
      if ("mode" in input) return { text: "Thrust. [p. 4]" };
      if (spent) return { mode: "study_text", reason: "Terse." };
      // The second section's first mode call spends past the limit, so its
      // writing call stops.
      spent = true;
      vi.stubEnv("AI_DAILY_LIMIT_USD", "1");
      db.tables.ai_usage.push({
        owner: STUDENT,
        task: "chat",
        cost_usd: 5,
        created_at: new Date().toISOString(),
      });
      return { mode: "study_text", reason: "Terse." };
    });
    useMockModels(models);

    expect(await update()).toBe("failed");
    expect(db.tables.knowledge_map_builds[0]?.failure_reason).toBe(
      "Daily limit reached",
    );
    expect(stored()).toEqual([
      expect.objectContaining({ pages: [1, 3], reason: "Reads well." }),
    ]);

    // The next day: the spend no longer counts.
    db.tables.ai_usage = db.tables.ai_usage.filter(
      (row) => row.task !== "chat",
    );
    const before = sent.filter(isReadingCall).length;
    expect(await update()).toBe("built");
    const rerun = sent.filter(isReadingCall).slice(before);
    expect(rerun.map((input) => input.section)).toEqual([
      expect.objectContaining({ pageFrom: 4 }),
      expect.objectContaining({ pageFrom: 4 }),
    ]);
    expect(stored()).toEqual([
      expect.objectContaining({ pages: [1, 3], reason: "Reads well." }),
      expect.objectContaining({ pages: [4, 5], mode: "study_text" }),
    ]);
  });

  test("a rerun keeps the stored sections with their modes and makes no call", async () => {
    const { models, sent } = course();
    useMockModels(models);

    expect(await update()).toBe("built");
    const first = stored();
    expect(first).toEqual([
      expect.objectContaining({
        pages: [1, 3],
        chunks: 3,
        mode: "original",
        reason: "Reads well.",
      }),
      expect.objectContaining({ pages: [4, 5], chunks: 2 }),
    ]);

    // A judgement made earlier stays: the section keeps its row and mode.
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
