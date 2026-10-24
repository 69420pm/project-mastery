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
  type Sent,
} from "./build-testing";

vi.mock("server-only", () => ({}));

const COURSE = "aaaaaaaa-c000-4000-8000-000000000004";

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

const isTopicCall = (input: Sent) => "storedTopics" in input;

/** Each Topic's name with its KCs' names in teaching order. */
function storedTopics() {
  const nameOf = (id: unknown) =>
    db.tables.kcs.find((row) => row.id === id)?.name;
  return db.tables.topics.map((topic) => ({
    id: topic.id,
    kcs: db.tables.topic_kcs
      .filter((row) => row.topic_id === topic.id)
      .map((row) => nameOf(row.kc_id)),
  }));
}

/**
 * Two big ideas of two KCs each on Lecture 1; each later Material adds one
 * KC to Propulsion. `topic` answers the topic calls.
 */
function course(topic?: (input: Sent) => unknown) {
  seedMaterial(db, COURSE, "Lecture 1", "parsed", [
    ["content", "Thrust and drag."],
    ["content", "Fins and airflow cool."],
  ]);
  let updates = 0;
  return mapModel({
    skeleton: () =>
      updates++ === 0
        ? {
            bigIdeas: [
              {
                name: "Propulsion",
                description: "Making thrust.",
                kcs: ["Thrust", "Drag"].map((name) => ({
                  name,
                  description: ".",
                })),
              },
              {
                name: "Cooling",
                description: "Keeping cool.",
                kcs: ["Fins", "Airflow"].map((name) => ({
                  name,
                  description: ".",
                })),
              },
            ],
          }
        : {
            bigIdeas: [
              {
                name: "Propulsion",
                description: "Making thrust.",
                kcs: [{ name: "Nozzle", description: "." }],
              },
            ],
          },
    assign: (call): { taught: Record<string, string[]>; newKcs: [] } => ({
      taught:
        call === 0 ? { c1: ["k1", "k2"], c2: ["k3", "k4"] } : { c1: ["k5"] },
      newKcs: [],
    }),
    topic,
  });
}

describe("the Topics stage", () => {
  test("a build stores a Topic per big idea, and an update with one new KC makes one call and keeps every Topic id", async () => {
    const { models, sent } = course();
    useMockModels(models);

    expect(await update()).toBe("built");
    expect(sent.filter(isTopicCall)).toHaveLength(2);
    const first = storedTopics();
    expect(first.map((topic) => topic.kcs)).toEqual([
      ["Thrust", "Drag"],
      ["Fins", "Airflow"],
    ]);

    const calls = sent.length;
    seedMaterial(db, COURSE, "Lecture 2", "parsed", [
      ["content", "The nozzle accelerates the flow."],
    ]);
    expect(await update()).toBe("built");
    const topicCalls = sent.slice(calls).filter(isTopicCall);
    expect(topicCalls).toHaveLength(1);
    expect(topicCalls[0]?.storedTopics).toEqual([
      expect.objectContaining({ id: "t1", kcs: ["k1", "k2"] }),
    ]);
    // The new KC's one-KC Topic merges into the stored one.
    expect(storedTopics()).toEqual([
      { id: first[0]?.id, kcs: ["Thrust", "Drag", "Nozzle"] },
      first[1],
    ]);

    // Nothing new: no call, same Topics.
    const settled = sent.length;
    expect(await update()).toBe("built");
    expect(sent).toHaveLength(settled);
    expect(db.tables.topics.map((row) => row.id)).toEqual(
      first.map((topic) => topic.id),
    );
  });

  test("a failed topic step fails the build with the map stored, and the next update stores the Topics", async () => {
    let broken = true;
    const { models, sent } = course((input) => {
      const kcs = (input.kcs as Array<{ id: string }>).map((kc) => kc.id);
      // Broken, it leaves out the last new KC, which fails the check.
      return {
        topics: [
          {
            id: "new1",
            name: "Topic",
            centralQuestion: "Why?",
            whyItMatters: ".",
            kcs: broken ? kcs.slice(0, -1) : kcs,
          },
        ],
      };
    });
    useMockModels(models);
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await update()).toBe("failed");
    expect(db.tables.kcs).toHaveLength(4);
    expect(db.tables.topics).toEqual([]);

    broken = false;
    const calls = sent.length;
    expect(await update()).toBe("built");
    const mapCalls = sent.slice(calls).filter((input) => !("section" in input));
    expect(mapCalls.every(isTopicCall)).toBe(true);
    expect(storedTopics().map((topic) => topic.kcs)).toEqual([
      ["Thrust", "Drag"],
      ["Fins", "Airflow"],
    ]);
  });
});
