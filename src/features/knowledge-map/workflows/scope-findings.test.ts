// @vitest-environment node
import { expect, test, vi } from "vitest";
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

const COURSE = "aaaaaaaa-c000-4000-8000-000000000003";

const db = createMapDb(COURSE);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));

const { buildKnowledgeMap } = await import("./build-knowledge-map");

async function update() {
  db.tables.knowledge_map_builds = [];
  seedBuild(db, COURSE);
  await buildKnowledgeMap(COURSE);
  expect(db.tables.knowledge_map_builds[0]).toMatchObject({ status: "built" });
}

const QUESTION =
  "Section 7.4 says nozzles are not exam-relevant this year. Should we skip them?";

test("new admin chunks yield scope Findings; an update without them makes no scope call", async () => {
  const [, , remark] = seedMaterial(db, COURSE, "Lecture 1", "parsed", [
    ["content", "Thrust is a force."],
    ["admin", "Chapter 7 · 186"],
    ["admin", "Section 7.4 is not exam-relevant this year."],
  ]);
  let skeletons = 0;
  const { models, sent } = mapModel({
    skeleton: () => ({
      bigIdeas:
        skeletons++ === 0
          ? [
              {
                name: "Propulsion",
                description: "Making thrust.",
                kcs: [{ name: "Thrust", description: "One line." }],
              },
            ]
          : [],
    }),
    assign: () => ({ taught: { c1: ["k1"] }, newKcs: [] }),
    // The remark's chunk, and an id the call never sent.
    scope: () => ({
      remarks: [{ chunkIds: ["c2", "c9"], question: QUESTION }],
    }),
  });
  useMockModels(models);

  await update();
  const scopeCalls = () => sent.filter((input) => "adminChunks" in input);
  expect(scopeCalls()).toEqual([
    {
      adminChunks: [
        {
          id: "c1",
          material: "Lecture 1",
          page: 2,
          markdown: "Chapter 7 · 186",
        },
        {
          id: "c2",
          material: "Lecture 1",
          page: 3,
          markdown: "Section 7.4 is not exam-relevant this year.",
        },
      ],
    },
  ]);
  expect(db.tables.findings).toMatchObject([{ kind: "scope", text: QUESTION }]);
  expect(db.tables.finding_sources.map((row) => row.chunk_id)).toEqual([
    remark,
  ]);

  seedMaterial(db, COURSE, "Lecture 2", "parsed", [
    ["content", "Thrust grows with mass flow."],
  ]);
  await update();
  expect(scopeCalls()).toHaveLength(1);
  expect(db.tables.findings).toMatchObject([{ kind: "scope", text: QUESTION }]);
});
