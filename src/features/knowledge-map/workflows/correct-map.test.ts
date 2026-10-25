// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import { useMockModels } from "@/lib/ai/testing";
import { markAdminClient } from "@/lib/supabase/admin-brand";
import type { Supabase } from "@/lib/supabase/types";
import {
  createMapDb,
  mapModel,
  seedBuild,
  seedMaterial,
  type Sent,
} from "./build-testing";

vi.mock("server-only", () => ({}));

const COURSE = "aaaaaaaa-c000-4000-8000-000000000003";

const db = createMapDb(COURSE);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));

const { buildKnowledgeMap } = await import("./build-knowledge-map");

type SentFinding = {
  id: string;
  kc: { id: string; name: string };
  linkedKc: { id: string; name: string } | null;
};

const none = {
  addPrerequisites: [],
  removePrerequisites: [],
  addSemanticLinks: [],
  removeSemanticLinks: [],
  descriptions: [],
};

/** The corrections call's answer; without one, the call fails. */
let correct: ((findings: SentFinding[]) => unknown) | undefined;

// The first build maps Thrust, which needs Drag and Lift, from one chunk.
const { models, sent } = mapModel({
  skeleton: {
    bigIdeas: [
      {
        name: "Propulsion",
        description: "Making thrust.",
        kcs: ["Thrust", "Drag", "Lift"].map((name) => ({
          name,
          description: "One line.",
        })),
      },
    ],
  },
  assign: () => ({ taught: { c1: ["k1", "k2", "k3"] }, newKcs: [] }),
  links: {
    prerequisites: [
      { from: "k2", to: "k1", extractionConfidence: 0.8 },
      { from: "k3", to: "k1", extractionConfidence: 0.8 },
    ],
    semanticLinks: [],
    priorKcs: [],
  },
  corrections: (input) => {
    if (!correct) throw new Error("The call failed.");
    return correct(input.findings as SentFinding[]);
  },
});

async function update() {
  db.tables.knowledge_map_builds = [];
  seedBuild(db, COURSE);
  await buildKnowledgeMap(COURSE);
  return db.tables.knowledge_map_builds[0];
}

let chunk: string | undefined;
async function buildMap() {
  if (chunk) return;
  [chunk] = seedMaterial(db, COURSE, "Lecture 1", "parsed", [
    ["content", "Thrust follows from momentum. Lift acts across the flow."],
  ]);
  expect(await update()).toMatchObject({ status: "built" });
  expect(prerequisites()).toEqual(["Drag → Thrust", "Lift → Thrust"]);
}

const kcId = (name: string) => db.tables.kcs.find((kc) => kc.name === name)?.id;
const kcName = (id: unknown) => db.tables.kcs.find((kc) => kc.id === id)?.name;
const prerequisites = () =>
  db.tables.prerequisite_links.map(
    (link) => `${kcName(link.from_kc)} → ${kcName(link.to_kc)}`,
  );
const finding = (id: string) =>
  db.tables.map_findings.find((row) => row.id === id);

function seedFinding(
  status: string,
  kind: string,
  kc: string,
  linked?: string,
) {
  const id = crypto.randomUUID();
  db.tables.map_findings.push({
    id,
    course_id: COURSE,
    kind,
    kc_id: kcId(kc),
    linked_kc_id: linked ? kcId(linked) : null,
    chunk_id: chunk,
    quote: "Thrust follows from momentum.",
    reason: "The lecture says so.",
    status,
    outcome: null,
    created_at: new Date().toISOString(),
  });
  return id;
}

describe("correcting the map with accepted map Findings", () => {
  test("applies a removal and a description without new chunks, dropping changes to other KCs", async () => {
    useMockModels(models);
    await buildMap();
    const wrongLink = seedFinding("accepted", "wrong_link", "Thrust", "Drag");
    const wrongDescription = seedFinding(
      "accepted",
      "wrong_description",
      "Lift",
    );
    const open = seedFinding("open", "wrong_description", "Drag");
    correct = (findings) => {
      const [link, lift] = findings;
      if (!link?.linkedKc || !lift) throw new Error("Findings missing.");
      return {
        findings: {
          [link.id]: {
            ...none,
            outcome: "Removed the prerequisite.",
            removePrerequisites: [
              { from: link.linkedKc.id, to: link.kc.id },
              // Lift is not this Finding's KC.
              { from: lift.kc.id, to: link.kc.id },
            ],
          },
          [lift.id]: {
            ...none,
            outcome: "Described lift.",
            descriptions: [
              { kcId: lift.kc.id, description: "Lift acts across the flow." },
              // Thrust is not this Finding's KC.
              { kcId: link.kc.id, description: "Wrong." },
            ],
          },
        },
      };
    };
    const calls = sent.length;

    expect(await update()).toMatchObject({ status: "built" });
    // One call, with the two accepted Findings only.
    expect(sent.slice(calls)).toEqual([
      expect.objectContaining({ findings: expect.any(Array) }),
    ]);
    expect(
      (sent.at(-1) as Sent & { findings: unknown[] }).findings,
    ).toHaveLength(2);
    expect(prerequisites()).toEqual(["Lift → Thrust"]);
    expect(
      db.tables.kcs.map(({ name, description }) => ({ name, description })),
    ).toEqual([
      { name: "Thrust", description: "Sharp Thrust" },
      { name: "Drag", description: "Sharp Drag" },
      { name: "Lift", description: "Lift acts across the flow." },
    ]);
    expect(finding(wrongLink)).toMatchObject({
      status: "applied",
      outcome: "Removed the prerequisite.",
    });
    expect(finding(wrongDescription)).toMatchObject({
      status: "applied",
      outcome: "Described lift.",
    });
    expect(finding(open)).toMatchObject({ status: "open", outcome: null });
  });

  test("a failed call fails the build and leaves the Findings accepted", async () => {
    useMockModels(models);
    await buildMap();
    const before = prerequisites();
    const accepted = seedFinding("accepted", "missing_link", "Thrust", "Drag");
    correct = undefined;
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await update()).toMatchObject({ status: "failed" });
    expect(finding(accepted)).toMatchObject({
      status: "accepted",
      outcome: null,
    });
    expect(prerequisites()).toEqual(before);
  });
});
