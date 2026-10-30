import { cosineSimilarity } from "@/features/knowledge-map/domain/kc-clusters";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

export { useBuildModels } from "./build-models-testing";

/**
 * Test helpers for the build workflow in-process (`build-knowledge-map.ts`):
 * the admin client as a `fakeSupabase` whose database functions stand in
 * for the real ones, which pgTAP tests, and seeded Materials. The mock
 * models are in `build-models-testing.ts`. Each test file mocks
 * `@/lib/supabase/admin` with its own `db`.
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
      exercise_solutions: [] as FakeRow[],
      exercises: [] as FakeRow[],
      exercise_kcs: [] as FakeRow[],
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
        const exerciseParts = (args.p_parts as FakeRow[]).filter(
          (part) => part.exercises,
        );
        const chunksOf = (partId: unknown) =>
          new Set(
            tables.chunks
              .filter((chunk) => chunk.part_id === partId)
              .map((chunk) => chunk.id),
          );
        for (const part of exerciseParts) {
          const chunks = chunksOf(part.partId);
          tables.kc_sources = tables.kc_sources.filter(
            (source) => !chunks.has(source.chunk_id),
          );
        }
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
              origin: kc.origin ?? "content",
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
        for (const part of exerciseParts) {
          const chunks = chunksOf(part.partId);
          const listed = part.exercises as FakeRow[];
          tables.exercises = tables.exercises.filter(
            (row) =>
              !chunks.has(row.question_chunk_id) ||
              listed.some((x) => x.questionChunkId === row.question_chunk_id),
          );
          for (const x of listed) {
            const answers = x.finalAnswers as unknown[];
            const values = {
              solution_chunk_id: tables.chunks.some(
                (chunk) => chunk.id === x.solutionChunkId,
              )
                ? x.solutionChunkId
                : null,
              difficulty: x.difficulty,
              final_answers: answers.length > 0 ? answers : null,
            };
            let row = tables.exercises.find(
              (e) => e.question_chunk_id === x.questionChunkId,
            );
            if (row) Object.assign(row, values);
            else {
              row = {
                ...owned,
                id: crypto.randomUUID(),
                question_chunk_id: x.questionChunkId,
                position: tables.exercises.length,
                ...values,
              };
              tables.exercises.push(row);
            }
            const exerciseId = row.id;
            tables.exercise_kcs = [
              ...tables.exercise_kcs.filter(
                (link) => link.exercise_id !== exerciseId,
              ),
              ...(x.kcIds as string[]).map((kcId) => ({
                ...owned,
                exercise_id: exerciseId,
                kc_id: kcId,
              })),
            ];
          }
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
      store_assumed_prerequisites: (args, tables) => {
        const build = building(tables, args.p_course_id);
        if (!build) return false;
        for (const link of args.p_prerequisites as FakeRow[]) {
          tables.prerequisite_links.push({
            owner: build.owner,
            course_id: args.p_course_id,
            from_kc: link.from,
            to_kc: link.to,
          });
        }
        for (const row of tables.part_extractions) {
          if ((args.p_part_ids as string[]).includes(row.part_id as string)) {
            row.assumes_matched = true;
          }
        }
        return true;
      },
      store_named_topics: (args, tables) => {
        const build = building(tables, args.p_course_id);
        if (!build) return false;
        for (const topic of args.p_topics as FakeRow[]) {
          const hashes = JSON.stringify(topic.partHashes);
          if (
            tables.topics.some(
              (row) => JSON.stringify(row.part_hashes) === hashes,
            )
          ) {
            continue;
          }
          let bigIdea = tables.big_ideas.find(
            (row) => row.name === topic.bigIdea,
          );
          if (!bigIdea) {
            bigIdea = {
              id: crypto.randomUUID(),
              owner: build.owner,
              course_id: args.p_course_id,
              name: topic.bigIdea,
              description: topic.bigIdea,
              position: tables.big_ideas.length,
            };
            tables.big_ideas.push(bigIdea);
          }
          tables.topics.push({
            id: crypto.randomUUID(),
            owner: build.owner,
            course_id: args.p_course_id,
            big_idea_id: bigIdea.id,
            name: topic.name,
            central_question: topic.centralQuestion,
            position: tables.topics.length,
            part_hashes: topic.partHashes,
          });
        }
        return true;
      },
      alike_kcs: (args, tables) => {
        const live = tables.kcs.filter(
          (kc) =>
            kc.course_id === args.p_course_id && !kc.retired_at && kc.embedding,
        );
        return live
          .flatMap((a, i) =>
            live.slice(i + 1).map((b) => ({
              a: a.id,
              b: b.id,
              similarity: cosineSimilarity(
                vectorOf(a.embedding),
                vectorOf(b.embedding),
              ),
            })),
          )
          .filter((pair) => pair.similarity >= Number(args.p_similarity));
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
        const topics = args.p_topics as Array<{
          id: string;
          bigIdea: string;
          kcs: string[];
        }>;
        tables.topics = topics.map((topic, position) => ({
          ...tables.topics.find((row) => row.id === topic.id)!,
          position,
          big_idea_id: tables.big_ideas.find(
            (row) => row.name === topic.bigIdea,
          )!.id,
        }));
        tables.topic_kcs = topics.flatMap((topic) =>
          topic.kcs.map((kcId, position) => ({
            topic_id: topic.id,
            kc_id: kcId,
            owner: build.owner,
            position,
          })),
        );
        const dropped = args.p_dropped_prerequisites as FakeRow[];
        tables.prerequisite_links = tables.prerequisite_links.filter(
          (link) =>
            !dropped.some(
              (drop) => drop.from === link.from_kc && drop.to === link.to_kc,
            ),
        );
        build.check_report = args.p_check_report;
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

/**
 * A chunk to seed: its Markdown, or also its label (by default `content`
 * in a teaching Part, `exercise` in an exercise Part) and exercise number.
 */
type SeedChunk =
  | string
  | { markdown: string; label?: "exercise" | "solution"; number?: string };

/** A Part to seed: its kind, titles and chunks. */
type SeedPart = {
  title: string;
  chapter?: string;
  kind?: "teaching" | "exercise";
  chunks?: SeedChunk[];
};

/**
 * Every chunk's vector: alike to every KC vector of `useBuildModels`, so
 * an exercise call is offered every KC.
 */
const CHUNK_VECTOR = JSON.stringify(Array.from({ length: 64 }, () => 1));

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
    const kind = part.kind ?? "teaching";
    const chunks = (part.chunks ?? [`About ${part.title}.`]).map((chunk) =>
      typeof chunk === "string" ? { markdown: chunk } : chunk,
    );
    db.tables.parts.push({
      ...owned,
      id: partId,
      position: index,
      kind,
      title: part.title,
      chapter_title: part.chapter ?? part.title,
      content_hash: [part.title, ...chunks.map((chunk) => chunk.markdown)]
        .join("|")
        .padEnd(64, "#"),
    });
    for (const chunk of chunks) {
      db.tables.chunks.push({
        ...owned,
        id: crypto.randomUUID(),
        part_id: partId,
        position: chunkPosition++,
        page_from: 1,
        page_to: 1,
        label: chunk.label ?? (kind === "exercise" ? "exercise" : "content"),
        markdown: chunk.markdown,
        exercise_number: chunk.number ?? null,
        embedding: CHUNK_VECTOR,
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
  db.tables.exercise_solutions = db.tables.exercise_solutions.filter(
    (row) =>
      !chunks.has(row.exercise_chunk_id) && !chunks.has(row.solution_chunk_id),
  );
  db.tables.exercises = db.tables.exercises.filter(
    (row) => !chunks.has(row.question_chunk_id),
  );
  for (const exercise of db.tables.exercises) {
    if (chunks.has(exercise.solution_chunk_id)) {
      exercise.solution_chunk_id = null;
    }
  }
}

/** The id of the seeded chunk with this Markdown. */
export function chunkWith(db: BuildDb, markdown: string): string {
  return db.tables.chunks.find((chunk) => chunk.markdown === markdown)!
    .id as string;
}

/** Pairs an exercise chunk with a solution chunk, as pairing stores it. */
export function pair(db: BuildDb, exercise: string, solution: string) {
  db.tables.exercise_solutions.push({
    owner: STUDENT,
    course_id: COURSE,
    exercise_chunk_id: chunkWith(db, exercise),
    solution_chunk_id: chunkWith(db, solution),
    status: "paired",
  });
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

/** The Topics' names in Course order, with their KCs' names in order. */
export function storedTopics(db: BuildDb) {
  const kcName = (id: unknown) =>
    db.tables.kcs.find((kc) => kc.id === id)?.name;
  return db.tables.topics
    .toSorted((a, b) => Number(a.position) - Number(b.position))
    .map((topic) => [
      topic.name,
      db.tables.topic_kcs
        .filter((row) => row.topic_id === topic.id)
        .toSorted((a, b) => Number(a.position) - Number(b.position))
        .map((row) => kcName(row.kc_id)),
    ]);
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
