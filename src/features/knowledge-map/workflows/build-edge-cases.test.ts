// @vitest-environment node
import { APICallError } from "ai";
import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useMockModels } from "@/lib/ai/testing";
import { markAdminClient } from "@/lib/supabase/admin-brand";
import type { FakeRow } from "@/lib/supabase/testing";
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

const COURSE = "aaaaaaaa-c000-4000-8000-000000000003";

let db = createMapDb(COURSE);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));

const { buildKnowledgeMap } = await import("./build-knowledge-map");

/**
 * A build that reaches every step: two KCs that embed alike, a third that
 * needs one of them, an exercise that tests it and an `admin` chunk.
 */
function seedCourse() {
  seedBuild(db, COURSE);
  return seedMaterial(db, COURSE, "Lecture 1", "parsed", [
    ["definition", "# Thrust\n**Thrust** pushes the aircraft."],
    ["content", "Thrust force is a reaction to the exhaust."],
    ["content", "Mass resists acceleration."],
    ["admin", "The exam covers chapters 1 to 3."],
    ["exercise", "Compute the thrust.", "1"],
  ]);
}

const model = () =>
  mapModel({
    skeleton: {
      bigIdeas: [
        {
          name: "Propulsion",
          description: "Making thrust.",
          kcs: ["Thrust", "Thrust force", "Mass"].map((name) => ({
            name,
            description: `${name}.`,
          })),
        },
      ],
    },
    assign: () => ({
      taught: { c1: ["k1"], c2: ["k2"], c3: ["k3"] },
      newKcs: [],
    }),
    links: {
      prerequisites: [{ from: "k3", to: "k2", extractionConfidence: 0.9 }],
      semanticLinks: [],
      priorKcs: [],
    },
    exercise: () => ({
      kcIds: ["k2"],
      newKcs: [],
      taskType: "compute thrust",
      solution: "Solved.",
      finalResult: "1",
      finalAnswers: [],
      steps: 1,
    }),
    alike: [["Thrust", "Thrust force"]],
  });

beforeEach(() => {
  db = createMapDb(COURSE);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("merging duplicate KCs in a build", () => {
  test("merges two KCs that embed alike and keeps their sources, prerequisites and Exercise links", async () => {
    const [thrust, thrustForce, mass] = seedCourse();
    const { models, sent } = model();
    useMockModels(models);
    vi.spyOn(console, "info").mockImplementation(() => {});

    await buildKnowledgeMap(COURSE);

    expect(db.tables.knowledge_map_builds[0]).toMatchObject({
      status: "built",
    });
    expect(sent.find((input) => "clusters" in input)?.clusters).toMatchObject([
      { kcs: [{ name: "Thrust" }, { name: "Thrust force" }] },
    ]);
    expect(db.tables.kcs.map((row) => row.name)).toEqual(["Thrust", "Mass"]);
    const [kept, massKc] = db.tables.kcs.map((row) => row.id);
    const sourcesOf = (kcId: unknown) =>
      db.tables.kc_sources
        .filter((row) => row.kc_id === kcId)
        .map((row) => row.chunk_id);
    expect(sourcesOf(kept)).toEqual([thrust, thrustForce]);
    expect(sourcesOf(massKc)).toEqual([mass]);
    expect(db.tables.prerequisite_links).toMatchObject([
      { from_kc: massKc, to_kc: kept },
    ]);
    expect(db.tables.exercise_kcs).toMatchObject([{ kc_id: kept }]);
    expect(db.tables.knowledge_map_builds[0]?.check_report).toMatchObject({
      duplicates: [],
    });
  });
});

/** The build's model calls in order, each recorded as this AI task. */
const STAGES = [
  ["skeleton", "map"],
  ["assign", "map"],
  ["fill", "map"],
  ["links", "map"],
  ["exercise", "exercise"],
  ["scope", "map"],
  ["embed", "embed"],
  ["merge", "map"],
] as const;
type Stage = (typeof STAGES)[number][0];

const stageOf = (input: Sent): Stage =>
  "adminChunks" in input
    ? "scope"
    : "clusters" in input
      ? "merge"
      : "exercise" in input
        ? "exercise"
        : "definitions" in input
          ? "skeleton"
          : "chunks" in input
            ? "assign"
            : "bigIdea" in input
              ? "fill"
              : "links";

const quotaError = () =>
  new APICallError({
    message: "Quota exceeded",
    url: "https://example.com",
    requestBodyValues: {},
    statusCode: 429,
    responseBody: '{"error":{"message":"Requests per day exceeded"}}',
    isRetryable: false,
  });

/**
 * The build's models, stopped at `stop`: by the provider's daily quota
 * there, or by the Daily limit, which the spend after the call before it
 * reaches. Records the stages called.
 */
function stoppingModels(stop: Stage, by: "quota" | "limit") {
  const { models } = model();
  const called: Stage[] = [];
  const index = STAGES.findIndex(([stage]) => stage === stop);
  const before = (stage: Stage) => {
    called.push(stage);
    if (by === "quota" && stage === stop) throw quotaError();
  };
  const after = (stage: Stage) => {
    if (by === "limit" && STAGES[index - 1]?.[0] === stage) overspend();
  };
  const map = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const message = options.prompt.findLast((m) => m.role === "user");
      const text = (message?.content as Array<{ text: string }>)[0]?.text;
      const stage = stageOf(JSON.parse(text ?? "{}") as Sent);
      before(stage);
      const result = await models.map.doGenerate(options);
      after(stage);
      return result;
    },
  });
  const embed = new MockEmbeddingModelV4({
    // Every KC in one call, as a provider batches them.
    maxEmbeddingsPerCall: null,
    doEmbed: async (options) => {
      before("embed");
      const result = await models.embed.doEmbed(options);
      after("embed");
      return result;
    },
  });
  if (by === "limit" && index === 0) overspend();
  return { models: { map, exercise: map, embed }, called };
}

/** Spends past a $1 Daily limit today. */
function overspend() {
  vi.stubEnv("AI_DAILY_LIMIT_USD", "1");
  db.tables.ai_usage.push({
    owner: STUDENT,
    task: "chat",
    cost_usd: 5,
    created_at: new Date().toISOString(),
  });
}

describe("a build stopped by the Daily limit or the daily quota", () => {
  test.each(
    STAGES.flatMap(([stage]) =>
      (["quota", "limit"] as const).map((by) => [stage, by] as const),
    ),
  )(
    "at the %s call, by the %s, fails with that reason and keeps the previous map",
    async (stop, by) => {
      seedCourse();
      const old = {
        id: "old",
        course_id: COURSE,
        name: "Old idea",
        description: "Stored.",
        position: 0,
      };
      db.tables.big_ideas.push(old);
      const { models, called } = stoppingModels(stop, by);
      useMockModels(models);

      await buildKnowledgeMap(COURSE);

      const index = STAGES.findIndex(([stage]) => stage === stop);
      const earlier = STAGES.slice(0, index).map(([stage]) => stage);
      // The Daily limit stops before the call, the quota in it.
      expect(called).toEqual(by === "quota" ? [...earlier, stop] : earlier);
      expect(db.tables.knowledge_map_builds[0]).toMatchObject({
        status: "failed",
        failure_reason: "Daily limit reached",
      });
      expect(db.tables.big_ideas).toEqual([old]);
      expect(db.tables.kcs).toEqual([]);
      expect(db.tables.knowledge_map_chunks).toEqual([]);
      // One row per completed call; the mock embedding reports no usage,
      // so only its row is estimated.
      expect(
        db.tables.ai_usage
          .filter((row: FakeRow) => row.task !== "chat")
          .map((row) => [row.task, row.estimated]),
      ).toEqual(
        STAGES.slice(0, index).map(([, task]) => [task, task === "embed"]),
      );
    },
  );
});
