// @vitest-environment node
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useMockModels } from "@/lib/ai/testing";
import { markAdminClient } from "@/lib/supabase/admin-brand";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";
import type { Supabase } from "@/lib/supabase/types";

vi.mock("server-only", () => ({}));

const STUDENT = "11111111-1111-1111-1111-111111111111";
const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";

/**
 * The admin client of the workflow. `replace_knowledge_map` stands in for the
 * database function, which pgTAP tests: it swaps in the map's big ideas,
 * KCs and sources while the build runs, and marks it built.
 */
function createDb() {
  return fakeSupabase({
    tables: {
      materials: [] as FakeRow[],
      chunks: [] as FakeRow[],
      knowledge_map_builds: [] as FakeRow[],
      big_ideas: [] as FakeRow[],
      kcs: [] as FakeRow[],
      kc_sources: [] as FakeRow[],
      prerequisite_links: [] as FakeRow[],
      semantic_links: [] as FakeRow[],
      ai_usage: [] as FakeRow[],
    },
    defaults: { ai_usage: () => ({ created_at: new Date().toISOString() }) },
    functions: {
      replace_knowledge_map: (args, tables) => {
        const build = tables.knowledge_map_builds.find(
          (row) =>
            row.course_id === args.p_course_id && row.status === "building",
        );
        if (!build) return false;
        const map = args.p_map as {
          bigIdeas: Array<{ id: string; name: string }>;
          kcs: Array<
            FakeRow & { id: string; bigIdea: string | null; sources: string[] }
          >;
        };
        const rowId = (id: string) => `${COURSE}:${id}`;
        tables.big_ideas = map.bigIdeas.map((bigIdea, position) => ({
          id: rowId(bigIdea.id),
          name: bigIdea.name,
          position,
        }));
        const links = args.p_map as {
          prerequisites: Array<{ from: string; to: string }>;
          semanticLinks: Array<{ from: string; to: string; label: string }>;
        };
        tables.prerequisite_links = links.prerequisites.map((link) => ({
          from_kc: rowId(link.from),
          to_kc: rowId(link.to),
        }));
        tables.semantic_links = links.semanticLinks.map((link) => ({
          from_kc: rowId(link.from),
          to_kc: rowId(link.to),
          label: link.label,
        }));
        tables.kcs = map.kcs.map((kc, position) => ({
          id: rowId(kc.id),
          big_idea_id: kc.bigIdea && rowId(kc.bigIdea),
          name: kc.name,
          description: kc.description,
          type: kc.type,
          bloom: kc.bloom,
          position,
        }));
        tables.kc_sources = map.kcs.flatMap((kc) =>
          kc.sources.map((chunkId) => ({
            kc_id: rowId(kc.id),
            chunk_id: chunkId,
          })),
        );
        Object.assign(build, {
          status: "built",
          check_report: args.p_check_report,
          finished_at: new Date().toISOString(),
        });
        return true;
      },
    },
  });
}

let db = createDb();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => markAdminClient(db as unknown as Supabase),
}));

const { buildKnowledgeMap } = await import("./build-knowledge-map");

/**
 * A Material of the Course with chunks of these labels and markdown, one per
 * page; returns their ids.
 */
function seedMaterial(
  name: string,
  parseStatus: string,
  chunks: Array<[label: string, markdown: string]>,
) {
  const materialId = crypto.randomUUID();
  db.tables.materials.push({
    id: materialId,
    owner: STUDENT,
    course_id: COURSE,
    name,
    parse_status: parseStatus,
  });
  return chunks.map(([label, markdown], position) => {
    const id = crypto.randomUUID();
    db.tables.chunks.push({
      id,
      material_id: materialId,
      course_id: COURSE,
      position,
      page_from: position + 1,
      label,
      markdown,
    });
    return id;
  });
}

type Sent = Record<string, unknown> & {
  kcs?: Array<{ id: string; name: string }>;
  chunks?: Array<{ id: string; markdown: string }>;
};

/**
 * The `map` model: answers the skeleton, each assignment and each fill call
 * with the test's function of what the call was sent, and the links call
 * with the test's links or none, and remembers what each call was sent.
 */
function mapModel(answers: {
  skeleton: unknown;
  assign: (call: number) => {
    taught: Record<string, string[]>;
    newKcs: Array<{
      name: string;
      description: string;
      bigIdea: string;
      chunkIds: string[];
    }>;
  };
  links?: unknown;
}) {
  const sent: Sent[] = [];
  let assignments = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const message = prompt.findLast((m) => m.role === "user");
      const input = JSON.parse(
        (message?.content as Array<{ text: string }>)[0]?.text ?? "{}",
      ) as Sent;
      sent.push(input);
      let answer: unknown;
      if ("definitions" in input) answer = answers.skeleton;
      else if ("chunks" in input) {
        // Every sent chunk, teaching nothing unless the test says so; a
        // new KC goes under each chunk that teaches it.
        const { taught, newKcs } = answers.assign(assignments++);
        answer = {
          chunks: Object.fromEntries(
            (input.chunks ?? []).map(({ id }) => [
              id,
              {
                kcIds: taught[id] ?? [],
                newKcs: newKcs
                  .filter((kc) => kc.chunkIds.includes(id))
                  .map(({ name, description, bigIdea }) => ({
                    name,
                    description,
                    bigIdea,
                  })),
              },
            ]),
          ),
        };
      } else if (!("bigIdea" in input))
        answer = answers.links ?? {
          prerequisites: [],
          semanticLinks: [],
          priorKcs: [],
        };
      else
        answer = {
          kcs: Object.fromEntries(
            (input.kcs ?? []).map((kc) => [
              kc.id,
              {
                type: "concept",
                bloom: "apply",
                description: `Sharp ${kc.name}`,
              },
            ]),
          ),
        };
      return {
        content: [{ type: "text", text: JSON.stringify(answer) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: {
            total: 1000,
            noCache: 1000,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 200, text: 200, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { model, sent };
}

function seedBuild() {
  db.tables.knowledge_map_builds.push({
    course_id: COURSE,
    owner: STUDENT,
    status: "building",
    failure_reason: null,
  });
}

beforeEach(() => {
  db = createDb();
});

describe("building a Knowledge map", () => {
  test("drafts big ideas, assigns chunks in batches and fills each KC", async () => {
    seedBuild();
    // Eleven teaching chunks make two batches; the exercise is not sent.
    const chunks = seedMaterial("Lecture 1", "parsed", [
      ["definition", "# Compressors\n**Pressure ratio** is p2/p1."],
      ["content", "The turbine drives the compressor."],
      ...Array.from({ length: 8 }, (_, i): [string, string] => [
        "content",
        `Filler ${i}`,
      ]),
      ["exercise", "Exercise 1: compute the pressure ratio."],
      ["content", "Turbine work equals compressor work."],
    ]);
    seedMaterial("Lecture 2", "queued", [["content", "Not parsed yet"]]);
    const { model, sent } = mapModel({
      skeleton: {
        bigIdeas: [
          {
            name: "Compression",
            description: "How air is compressed.",
            kcs: [
              { name: "Pressure ratio", description: "p2/p1." },
              { name: "Unused candidate", description: "No chunk teaches it." },
            ],
          },
          { name: "Empty idea", description: "Nothing here.", kcs: [] },
        ],
      },
      assign: (call) =>
        call === 0
          ? {
              taught: { c1: ["k1"] },
              newKcs: [
                {
                  name: "Turbine work",
                  description: "Drives it.",
                  bigIdea: "b1",
                  chunkIds: ["c2"],
                },
              ],
            }
          : { taught: { c1: ["k3"] }, newKcs: [] },
      links: {
        // A cycle, whose weaker edge goes.
        prerequisites: [
          { from: "k1", to: "k3", extractionConfidence: 0.8 },
          { from: "k3", to: "k1", extractionConfidence: 0.2 },
        ],
        semanticLinks: [
          { from: "k3", to: "k1", coreType: "causes", label: "raises" },
        ],
        priorKcs: [
          {
            name: "Ideal gas law",
            description: "pv = RT.",
            requiredBy: ["k1"],
            extractionConfidence: 0.9,
          },
        ],
      },
    });
    useMockModels({ map: model });

    await buildKnowledgeMap(COURSE);

    expect(db.tables.knowledge_map_builds[0]).toMatchObject({
      status: "built",
    });
    expect(db.tables.big_ideas.map((row) => row.name)).toEqual(["Compression"]);
    expect(
      db.tables.kcs.map(({ name, type, bloom, description }) => ({
        name,
        type,
        bloom,
        description,
      })),
    ).toEqual([
      {
        name: "Pressure ratio",
        type: "concept",
        bloom: "apply",
        description: "Sharp Pressure ratio",
      },
      {
        name: "Turbine work",
        type: "concept",
        bloom: "apply",
        description: "Sharp Turbine work",
      },
      {
        name: "Ideal gas law",
        type: "prior",
        bloom: null,
        description: "pv = RT.",
      },
    ]);
    expect(db.tables.kc_sources.map((row) => row.chunk_id)).toEqual([
      chunks[0],
      chunks[1],
      chunks[11],
    ]);
    const nameOf = (id: unknown) =>
      db.tables.kcs.find((row) => row.id === id)?.name;
    const links = (table: FakeRow[]) =>
      table.map((row) => `${nameOf(row.from_kc)} → ${nameOf(row.to_kc)}`);
    expect(links(db.tables.prerequisite_links)).toEqual([
      "Pressure ratio → Turbine work",
      "Ideal gas law → Pressure ratio",
    ]);
    expect(links(db.tables.semantic_links)).toEqual([
      "Turbine work → Pressure ratio",
    ]);
    expect(db.tables.knowledge_map_builds[0]?.check_report).toEqual({
      // The eight fillers teach nothing.
      uncoveredChunkIds: chunks.slice(2, 10),
      ungroundedKcs: [],
      orphanKcs: [],
      droppedCycleEdges: [
        {
          from: "Turbine work",
          to: "Pressure ratio",
          extractionConfidence: 0.2,
        },
      ],
    });

    const [skeleton, first, second, fill, linksCall] = sent;
    expect(skeleton).toEqual({
      materials: ["Lecture 1"],
      headings: ["Compressors"],
      definitions: ["# Compressors\n**Pressure ratio** is p2/p1."],
    });
    expect(first?.chunks).toHaveLength(10);
    // The second batch sees the KC the first one proposed.
    expect(second?.kcs?.map((kc) => kc.name)).toContain("Turbine work");
    expect(second?.chunks?.map((chunk) => chunk.markdown)).toEqual([
      "Turbine work equals compressor work.",
    ]);
    expect(fill?.kcs?.map((kc) => kc.name)).toEqual([
      "Pressure ratio",
      "Turbine work",
    ]);
    expect(linksCall?.kcs?.map((kc) => kc.id)).toEqual(["k1", "k3"]);
    expect(sent).toHaveLength(5);
    expect(db.tables.ai_usage.map((row) => row.task)).toEqual(
      Array(5).fill("map"),
    );
  });
});

describe("a failed build", () => {
  const oldMap = () =>
    db.tables.big_ideas.push({ id: "old", name: "Old idea" });

  test("stops at the Daily limit with that reason and keeps the previous map", async () => {
    vi.stubEnv("AI_DAILY_LIMIT_USD", "1");
    db.tables.ai_usage.push({
      owner: STUDENT,
      task: "chat",
      cost_usd: 5,
      created_at: new Date().toISOString(),
    });
    seedBuild();
    oldMap();
    seedMaterial("Lecture 1", "parsed", [["content", "Something"]]);
    const { model, sent } = mapModel({
      skeleton: { bigIdeas: [] },
      assign: () => ({ taught: {}, newKcs: [] }),
    });
    useMockModels({ map: model });

    await buildKnowledgeMap(COURSE);

    expect(sent).toHaveLength(0);
    expect(db.tables.knowledge_map_builds[0]).toMatchObject({
      status: "failed",
      failure_reason: "Daily limit reached",
    });
    expect(db.tables.big_ideas.map((row) => row.name)).toEqual(["Old idea"]);
  });

  test("fails with a general reason when a call's answer does not fit", async () => {
    seedBuild();
    oldMap();
    seedMaterial("Lecture 1", "parsed", [["content", "Something"]]);
    const { model } = mapModel({
      skeleton: { wrong: true },
      assign: () => ({ taught: {}, newKcs: [] }),
    });
    useMockModels({ map: model });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await buildKnowledgeMap(COURSE);

    expect(db.tables.knowledge_map_builds[0]).toMatchObject({
      status: "failed",
      failure_reason: "The knowledge map could not be built. Please try again.",
    });
    expect(db.tables.big_ideas.map((row) => row.name)).toEqual(["Old idea"]);
  });
});
