// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { markAdminClient } from "@/lib/supabase/admin-brand";
import type { Supabase } from "@/lib/supabase/types";
import {
  COURSE,
  createBuildDb,
  liveKcs,
  queueBuild,
  seedMaterial,
  useBuildModels,
} from "./build-testing";

/**
 * Update map with extraction calls that fail: a failed unit waits a step,
 * is then called in pieces, and is given up rather than failing the build.
 * A failed Prerequisite check is asked again in halved calls, and its
 * names stay as text after four failed tries.
 */

vi.mock("server-only", () => ({}));

let db = createBuildDb();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));

const { buildKnowledgeMap } = await import("./build-knowledge-map");

const build = () => db.tables.knowledge_map_builds[0];

async function update() {
  queueBuild(db);
  await buildKnowledgeMap(COURSE);
}

beforeEach(() => {
  db = createBuildDb();
});

test("leaves a unit whose call gives no answer to the next step", async () => {
  seedMaterial(db, { chapters: [{ title: "Vectors" }] });
  const { extractions } = useBuildModels({ blankCalls: 1 });

  await update();

  expect(extractions).toHaveLength(1);
  expect(build()?.status).toBe("built");
  expect(liveKcs(db)).toEqual(["Material 0"]);
});

test("leaves a unit whose call times out to the next step, and gives a single chunk up when it times out there too", async () => {
  seedMaterial(db, { chapters: [{ title: "Vectors" }] });
  useBuildModels({ timeoutCalls: 1 });

  await update();

  expect(build()?.status).toBe("built");
  expect(db.tables.ai_usage).toContainEqual(
    expect.objectContaining({ task: "map", estimated: true }),
  );

  seedMaterial(db, { chapters: [{ title: "Sums" }] });
  useBuildModels({ timeoutCalls: 2 });

  await update();

  expect(build()).toMatchObject({
    status: "built",
    check_report: expect.objectContaining({
      unitsNotExtracted: ["Material 1"],
    }),
  });
  expect(db.tables.chapter_extractions).toHaveLength(1);
});

/** The Chapter titles 0…n-1, each KC assuming the 30 names "N0"…"N29". */
function seedAssumingUnit() {
  seedMaterial(db, { chapters: [{ title: "Vectors" }] });
  const users = Array.from({ length: 10 }, (_, i) => `A${i}`);
  const names = Array.from({ length: 30 }, (_, i) => `N${i}`);
  return {
    kcsOf: () => [...users, ...names],
    // A KC assumes up to 3 names.
    assumesOf: (kc: string) =>
      users.includes(kc)
        ? names.slice(3 * Number(kc.slice(1)), 3 * Number(kc.slice(1)) + 3)
        : [],
  };
}

test("asks a unit's names in halved calls after each failure, and answers them on the last try", async () => {
  const { checks } = useBuildModels({
    ...seedAssumingUnit(),
    blankChecks: 2 + 3 + 5,
  });

  await update();

  // 30 names: 25 + 5, then 12 + 12 + 6, then 6 × 5, then 3 × 10 answered.
  expect(checks.map((names) => names.length)).toEqual([
    25, 5, 12, 12, 6, 6, 6, 6, 6, 6, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
  ]);
  expect(build()?.status).toBe("built");
  expect(db.tables.prerequisite_links).toHaveLength(0);
});

test("keeps a unit's names as text when its calls fail on every try", async () => {
  seedMaterial(db, { chapters: [{ title: "Vectors" }] });
  useBuildModels({
    kcsOf: () => ["A0", "N0"],
    assumesOf: (kc) => (kc === "A0" ? ["N0"] : []),
    blankChecks: 4,
  });

  await update();

  expect(build()?.status).toBe("built");
  expect(db.tables.kcs.find((kc) => kc.name === "A0")!.assumes).toEqual([
    expect.objectContaining({ name: "N0" }),
  ]);
});

test("calls a unit that failed twice in halves, and keeps the halves answered", async () => {
  seedMaterial(db, {
    chapters: [{ title: "Vectors", chunks: ["About sums.", "About bases."] }],
  });
  const { extractions } = useBuildModels({
    kcsOf: (unit) => unit.chunks.map((chunk) => chunk.markdown),
    chunkIdOf: (kc, unit) =>
      unit.chunks.find((chunk) => chunk.markdown === kc)!.id,
    timeoutCalls: 3,
  });

  await update();

  // Whole twice and one half time out; each half is answered once.
  expect(
    db.tables.ai_usage.filter((row) => row.task === "map" && row.estimated),
  ).toHaveLength(3);
  expect(extractions.map((unit) => unit.chunks.length)).toEqual([1, 1]);
  expect(build()).toMatchObject({
    status: "built",
    check_report: expect.objectContaining({ unitsNotExtracted: [] }),
  });
  expect(liveKcs(db)).toEqual(["About sums.", "About bases."]);
  expect(db.tables.chapter_extractions).toHaveLength(1);
});
