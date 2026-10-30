import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import { vi } from "vitest";
import { cosineSimilarity } from "@/features/knowledge-map/domain/kc-clusters";
import { useMockModels } from "@/lib/ai/testing";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

/**
 * Test helpers for the build workflow in-process (`build-knowledge-map.ts`):
 * the admin client as a `fakeSupabase` whose database functions stand in
 * for the real ones, which pgTAP tests, and a `map` model whose extraction
 * gives each Part the KCs a test names. KCs with the same name get the same
 * vector, so they consolidate, and the merge call says they are the same.
 * Each test file mocks `@/lib/supabase/admin` with its own `db`.
 */

export const STUDENT = "11111111-1111-1111-1111-111111111111";
export const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";

type Tables = Record<string, FakeRow[]>;

const building = (tables: Tables, courseId: unknown) =>
  tables.knowledge_map_builds!.find(
    (row) => row.course_id === courseId && row.status === "building",
  );

const vectorOf = (text: unknown) => JSON.parse(String(text)) as number[];

const now = () => new Date().toISOString();

export function createBuildDb() {
  return fakeSupabase({
    tables: {
      materials: [] as FakeRow[],
      parts: [] as FakeRow[],
      chunks: [] as FakeRow[],
      knowledge_map_builds: [] as FakeRow[],
      part_extractions: [] as FakeRow[],
      big_ideas: [] as FakeRow[],
      kcs: [] as FakeRow[],
      kc_sources: [] as FakeRow[],
      prerequisite_links: [] as FakeRow[],
      topics: [] as FakeRow[],
      topic_kcs: [] as FakeRow[],
      attempts: [] as FakeRow[],
      ai_usage: [] as FakeRow[],
    },
    defaults: { ai_usage: () => ({ created_at: now() }) },
    functions: {
      retire_unsourced_kcs: (args, tables) => {
        const retired = tables.kcs.filter(
          (kc) =>
            kc.course_id === args.p_course_id &&
            !kc.retired_at &&
            !tables.kc_sources.some((source) => source.kc_id === kc.id),
        );
        for (const kc of retired) kc.retired_at = now();
        const gone = new Set(
          tables.kcs.filter((kc) => kc.retired_at).map((kc) => kc.id),
        );
        tables.topic_kcs = tables.topic_kcs.filter(
          (row) => !gone.has(row.kc_id),
        );
        return retired.length;
      },
      match_kcs: (args, tables) => {
        const embedding = vectorOf(args.p_embedding);
        return tables.kcs
          .filter(
            (kc) =>
              kc.course_id === args.p_course_id &&
              kc.embedding &&
              Boolean(kc.retired_at) === Boolean(args.p_retired),
          )
          .map((kc) => ({
            id: kc.id,
            similarity: cosineSimilarity(vectorOf(kc.embedding), embedding),
          }))
          .toSorted((a, b) => b.similarity - a.similarity)
          .slice(0, Number(args.p_count));
      },
      store_part_kcs: (args, tables) => {
        const build = building(tables, args.p_course_id);
        if (!build) return false;
        const owned = { owner: build.owner, course_id: args.p_course_id };
        const bigIdeaId = (name: unknown) => {
          let bigIdea = tables.big_ideas.find((row) => row.name === name);
          if (!bigIdea) {
            bigIdea = {
              id: crypto.randomUUID(),
              ...owned,
              name,
              description: name,
              position: tables.big_ideas.length,
            };
            tables.big_ideas.push(bigIdea);
          }
          return bigIdea.id;
        };
        for (const kc of args.p_kcs as FakeRow[]) {
          if (kc.new) {
            tables.kcs.push({
              ...owned,
              id: kc.id,
              big_idea_id: bigIdeaId(kc.bigIdea),
              name: kc.name,
              description: kc.description,
              type: kc.type,
              origin: "content",
              position: tables.kcs.length,
              embedding: kc.embedding,
              retired_at: null,
              created_at: now(),
            });
          } else {
            const stored = tables.kcs.find((row) => row.id === kc.id);
            if (stored?.retired_at) {
              stored.retired_at = null;
              stored.big_idea_id = bigIdeaId(kc.bigIdea);
            }
          }
          for (const chunkId of kc.sources as string[]) {
            const known =
              tables.chunks.some((chunk) => chunk.id === chunkId) &&
              !tables.kc_sources.some(
                (row) => row.kc_id === kc.id && row.chunk_id === chunkId,
              );
            if (known) {
              tables.kc_sources.push({
                ...owned,
                kc_id: kc.id,
                chunk_id: chunkId,
              });
            }
          }
        }
        for (const link of args.p_prerequisites as FakeRow[]) {
          tables.prerequisite_links.push({
            ...owned,
            from_kc: link.from,
            to_kc: link.to,
          });
        }
        for (const part of args.p_parts as FakeRow[]) {
          const row = tables.part_extractions.find(
            (extraction) => extraction.part_id === part.partId,
          );
          if (!row) continue;
          const output = row.output as { kcs: FakeRow[] };
          row.kc_ids = part.kcIds;
          row.output = {
            ...output,
            kcs: output.kcs.map((kc) => ({ ...kc, embedding: undefined })),
          };
        }
        build.heartbeat_at = now();
        return true;
      },
      arrange_knowledge_map: (args, tables) => {
        const build = building(tables, args.p_course_id);
        if (!build) return false;
        const names = args.p_big_ideas as string[];
        const kept = tables.big_ideas.filter((row) =>
          names.includes(row.name as string),
        );
        tables.big_ideas = names.map((name, position) => ({
          ...(kept.find((row) => row.name === name) ?? {
            id: crypto.randomUUID(),
            owner: build.owner,
            course_id: args.p_course_id,
            name,
            description: name,
          }),
          position,
        }));
        const order = args.p_kcs as Array<{ id: string; bigIdea: string }>;
        for (const kc of tables.kcs) {
          const index = order.findIndex((row) => row.id === kc.id);
          if (index < 0) {
            kc.position = order.length + Number(kc.position);
            continue;
          }
          kc.position = index;
          kc.big_idea_id = tables.big_ideas.find(
            (row) => row.name === order[index]!.bigIdea,
          )!.id;
        }
        Object.assign(build, {
          status: "built",
          failure_reason: null,
          finished_at: now(),
          heartbeat_at: now(),
        });
        return true;
      },
    },
  });
}

export type BuildDb = ReturnType<typeof createBuildDb>;

/** A Part to seed: its kind, titles and chunks' Markdown. */
type SeedPart = {
  title: string;
  chapter?: string;
  kind?: "teaching" | "exercise";
  chunks?: string[];
};

/**
 * Seeds a parsed Material at `position` in Course order with its Parts and
 * chunks; each Part's content hash comes from its title and chunks.
 */
export function seedMaterial(
  db: BuildDb,
  {
    id = crypto.randomUUID(),
    position = db.tables.materials.length,
    language = "en",
    parts,
  }: { id?: string; position?: number; language?: string; parts: SeedPart[] },
) {
  const owned = { owner: STUDENT, course_id: COURSE, material_id: id };
  db.tables.materials.push({
    id,
    owner: STUDENT,
    course_id: COURSE,
    name: `Material ${position}`,
    position,
    language,
    parse_status: "parsed",
  });
  let chunkPosition = 0;
  parts.forEach((part, index) => {
    const partId = crypto.randomUUID();
    const markdowns = part.chunks ?? [`About ${part.title}.`];
    db.tables.parts.push({
      ...owned,
      id: partId,
      position: index,
      kind: part.kind ?? "teaching",
      title: part.title,
      chapter_title: part.chapter ?? part.title,
      content_hash: [part.title, ...markdowns].join("|").padEnd(64, "#"),
    });
    for (const markdown of markdowns) {
      db.tables.chunks.push({
        ...owned,
        id: crypto.randomUUID(),
        part_id: partId,
        position: chunkPosition++,
        page_from: 1,
        page_to: 1,
        label: "content",
        markdown,
      });
    }
  });
  return id;
}

/**
 * What deleting a Material leaves: its Parts, chunks, extractions and the
 * KC sources of its chunks are gone, as the foreign keys cascade.
 */
export function deleteMaterial(db: BuildDb, materialId: string) {
  const parts = new Set(
    db.tables.parts
      .filter((part) => part.material_id === materialId)
      .map((part) => part.id),
  );
  const chunks = new Set(
    db.tables.chunks
      .filter((chunk) => chunk.material_id === materialId)
      .map((chunk) => chunk.id),
  );
  db.tables.materials = db.tables.materials.filter(
    (row) => row.id !== materialId,
  );
  db.tables.parts = db.tables.parts.filter((row) => !parts.has(row.id));
  db.tables.chunks = db.tables.chunks.filter((row) => !chunks.has(row.id));
  db.tables.part_extractions = db.tables.part_extractions.filter(
    (row) => !parts.has(row.part_id),
  );
  db.tables.kc_sources = db.tables.kc_sources.filter(
    (row) => !chunks.has(row.chunk_id),
  );
}

/** Queues a build, as `queue_knowledge_map_build` does. */
export function queueBuild(db: BuildDb) {
  db.tables.knowledge_map_builds = [
    {
      course_id: COURSE,
      owner: STUDENT,
      status: "building",
      failure_reason: null,
      finished_at: null,
      heartbeat_at: now(),
    },
  ];
}

type Prompt = Array<{ role: string; content: unknown }>;

/** The JSON of a call's user message. */
function userJson(prompt: unknown): Record<string, unknown> {
  const user = (prompt as Prompt).find((message) => message.role === "user");
  const [part] = user!.content as Array<{ text: string }>;
  return JSON.parse(part!.text) as Record<string, unknown>;
}

/** A Part as its extraction call sent it. */
export type SentPart = {
  title: string;
  chapterTitle: string;
  language: string;
  kcBudget: number;
  chunks: Array<{ id: string; markdown: string }>;
};

const answer = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage: {
    inputTokens: {
      total: 100,
      noCache: 100,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 10, text: 10, reasoning: undefined },
  },
  warnings: [],
});

/**
 * Routes the `map` and `embed` tasks to mocks, one call at a time. The
 * extraction gives each Part the KCs `kcsOf` names (by default one named
 * after the Part's title), all citing its first chunk; the merge call calls
 * KCs of one cluster with the same name the same. Every KC text gets a
 * one-hot vector of its own, so equal texts are alike and others are not.
 * `afterCall` runs after each extraction call.
 */
export function useBuildModels({
  kcsOf = (part) => [part.title],
  afterCall,
}: {
  kcsOf?: (part: SentPart) => string[];
  afterCall?: (count: number) => void;
} = {}) {
  const extractions: SentPart[] = [];
  const merges: unknown[] = [];
  const embedded: string[] = [];
  const map = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const sent = userJson(prompt);
      if ("clusters" in sent) {
        merges.push(sent);
        const clusters = sent.clusters as Array<{
          kcs: Array<{ id: string; name: string }>;
        }>;
        return answer({
          same: clusters.flatMap((cluster) =>
            [...Map.groupBy(cluster.kcs, (kc) => kc.name).values()]
              .filter((group) => group.length > 1)
              .map((group) => ({ kcIds: group.map((kc) => kc.id) })),
          ),
        });
      }
      const part = sent as SentPart;
      extractions.push(part);
      const result = answer({
        kcs: kcsOf(part).map((name) => ({
          name,
          description: `About ${name}.`,
          type: "concept",
          chunkIds: [part.chunks[0]!.id],
          assumes: [],
        })),
        prerequisites: [],
      });
      afterCall?.(extractions.length);
      return result;
    },
  });
  const dimensions = 64;
  const texts: string[] = [];
  const embed = new MockEmbeddingModelV4({
    doEmbed: async ({ values }) => {
      embedded.push(...values);
      return {
        embeddings: values.map((text) => {
          if (!texts.includes(text)) texts.push(text);
          return Array.from({ length: dimensions }, (_, index) =>
            index === texts.indexOf(text) % dimensions ? 1 : 0,
          );
        }),
        usage: undefined,
        warnings: [],
      };
    },
  });
  useMockModels({ map, embed });
  vi.stubEnv("AI_CONCURRENCY", "1");
  return { extractions, merges, embedded };
}

/** The live KCs' names in map order, with their Big idea's name. */
export function liveKcs(db: BuildDb) {
  return db.tables.kcs
    .filter((kc) => !kc.retired_at)
    .toSorted((a, b) => Number(a.position) - Number(b.position))
    .map((kc) => [
      kc.name,
      db.tables.big_ideas.find((row) => row.id === kc.big_idea_id)?.name,
    ]);
}
