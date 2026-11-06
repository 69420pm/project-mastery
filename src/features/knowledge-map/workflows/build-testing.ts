import { cosineSimilarity } from "@/features/knowledge-map/domain/kc-clusters";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

export {
  flatTree,
  unitTitle,
  useBuildModels,
  type SentCourse,
} from "./build-models-testing";

/**
 * Test helpers for the build workflow in-process (`build-knowledge-map.ts`):
 * the admin client as a `fakeSupabase` whose database functions stand in
 * for the real ones, which pgTAP tests, and seeded Materials with their
 * Outlines. The mock models are in `build-models-testing.ts`. Each test
 * file mocks `@/lib/supabase/admin` with its own `db`.
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
      courses: [] as FakeRow[],
      materials: [] as FakeRow[],
      material_pages: [] as FakeRow[],
      chapters: [] as FakeRow[],
      chunks: [] as FakeRow[],
      knowledge_map_builds: [] as FakeRow[],
      chapter_extractions: [] as FakeRow[],
      kcs: [] as FakeRow[],
      kc_sources: [] as FakeRow[],
      prerequisite_links: [] as FakeRow[],
      exercise_solutions: [] as FakeRow[],
      exercises: [] as FakeRow[],
      exercise_kcs: [] as FakeRow[],
      attempts: [] as FakeRow[],
      topics: [] as FakeRow[],
      topic_kcs: [] as FakeRow[],
      ai_usage: [] as FakeRow[],
    },
    defaults: {
      ai_usage: () => ({ created_at: now() }),
      chapter_extractions: () => ({ id: crypto.randomUUID() }),
    },
    functions: {
      retire_unsourced_kcs: (args, tables) => {
        const live = (id: unknown) =>
          tables.kcs.some((kc) => kc.id === id && !kc.retired_at);
        let count = 0;
        for (let changed = true; changed;) {
          const retired = tables.kcs.filter(
            (kc) =>
              kc.course_id === args.p_course_id &&
              !kc.retired_at &&
              !tables.kc_sources.some((source) => source.kc_id === kc.id) &&
              !tables.prerequisite_links.some(
                (link) => link.from_kc === kc.id && live(link.to_kc),
              ),
          );
          for (const kc of retired) kc.retired_at = now();
          count += retired.length;
          changed = retired.length > 0;
        }
        return count;
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
      store_chapter_kcs: (args, tables) => {
        const build = building(tables, args.p_course_id);
        if (!build) return false;
        const owned = { owner: build.owner, course_id: args.p_course_id };
        const exerciseUnits = (args.p_units as FakeRow[]).filter(
          (unit) => unit.exercises,
        );
        for (const unit of exerciseUnits) {
          const chunks = new Set(unit.chunkIds as string[]);
          tables.kc_sources = tables.kc_sources.filter(
            (source) => !chunks.has(source.chunk_id as string),
          );
        }
        for (const kc of args.p_kcs as FakeRow[]) {
          if (kc.new) {
            tables.kcs.push({
              ...owned,
              id: kc.id,
              name: kc.name,
              description: kc.description,
              origin: kc.origin ?? "content",
              position: tables.kcs.length,
              embedding: kc.embedding,
              retired_at: null,
              created_at: now(),
            });
          } else {
            const stored = tables.kcs.find((row) => row.id === kc.id);
            if (stored?.retired_at) stored.retired_at = null;
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
        for (const unit of exerciseUnits) {
          const chunks = new Set(unit.chunkIds as string[]);
          const listed = unit.exercises as FakeRow[];
          tables.exercises = tables.exercises.filter(
            (row) =>
              !chunks.has(row.question_chunk_id as string) ||
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
        for (const unit of args.p_units as FakeRow[]) {
          const row = tables.chapter_extractions.find(
            (extraction) => extraction.id === unit.extractionId,
          );
          if (!row) continue;
          const output = row.output as { kcs: FakeRow[] };
          row.kc_ids = unit.kcIds;
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
        for (const kc of args.p_kcs as FakeRow[]) {
          if (kc.new) {
            tables.kcs.push({
              owner: build.owner,
              course_id: args.p_course_id,
              id: kc.id,
              name: kc.name,
              description: kc.description,
              origin: "content",
              position: tables.kcs.length,
              embedding: kc.embedding,
              retired_at: null,
              created_at: now(),
            });
          } else {
            const stored = tables.kcs.find((row) => row.id === kc.id);
            if (stored) stored.retired_at = null;
          }
        }
        for (const link of args.p_prerequisites as FakeRow[]) {
          tables.prerequisite_links.push({
            owner: build.owner,
            course_id: args.p_course_id,
            from_kc: link.from,
            to_kc: link.to,
          });
        }
        const ids = args.p_extraction_ids as string[];
        for (const row of tables.chapter_extractions) {
          if (ids.includes(row.id as string)) row.assumes_matched = true;
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
        const dropped = args.p_dropped_prerequisites as FakeRow[];
        tables.prerequisite_links = tables.prerequisite_links.filter(
          (link) =>
            !dropped.some(
              (drop) => drop.from === link.from_kc && drop.to === link.to_kc,
            ),
        );
        const order = args.p_kcs as string[];
        for (const kc of tables.kcs) {
          const index = order.indexOf(kc.id as string);
          kc.position = index < 0 ? order.length + Number(kc.position) : index;
        }
        // The Topic tree: continued ids kept, the others new.
        const planned = args.p_topics as FakeRow[];
        const ids = planned.map((topic) =>
          tables.topics.some((row) => row.id === topic.id)
            ? (topic.id as string)
            : crypto.randomUUID(),
        );
        tables.topics = planned.map((topic, index) => ({
          id: ids[index],
          owner: build.owner,
          course_id: args.p_course_id,
          parent_id: topic.parent === null ? null : ids[topic.parent as number],
          name: topic.name,
          central_question: topic.centralQuestion,
          chapter_ids: topic.chapterIds,
          position: index,
        }));
        tables.topic_kcs = planned.flatMap((topic, index) =>
          (topic.kcs as string[]).map((kcId, position) => ({
            topic_id: ids[index],
            kc_id: kcId,
            owner: build.owner,
            position,
          })),
        );
        Object.assign(build, {
          status: "built",
          failure_reason: null,
          finished_at: now(),
          heartbeat_at: now(),
          check_report: args.p_check_report,
          topic_tree_hash: args.p_topic_tree_hash,
        });
        return true;
      },
    },
  });
}

export type BuildDb = ReturnType<typeof createBuildDb>;

/** A chunk to seed: its Markdown, or also its label. */
type SeedChunk =
  string | { markdown: string; label?: "content" | "exercise" | "solution" };

/**
 * A Chapter to seed: its title, its own chunks (by default one `content`
 * chunk "About <title>.", or `exercise` ones in an exercise Chapter) and
 * its children.
 */
type SeedChapter = {
  title: string;
  exercise?: boolean;
  chunks?: SeedChunk[];
  children?: SeedChapter[];
};

/**
 * Every chunk's vector: alike to every KC vector of `useBuildModels`, so
 * an exercise call is offered every KC.
 */
const CHUNK_VECTOR = JSON.stringify(Array.from({ length: 64 }, () => 1));

/**
 * Seeds a parsed Material at `position` in Course order, with its Outline
 * below a root Chapter titled by its name, and the Chapters' chunks in
 * reading order.
 */
export function seedMaterial(
  db: BuildDb,
  {
    id = crypto.randomUUID(),
    position = db.tables.materials.length,
    language = "English",
    chapters,
  }: {
    id?: string;
    position?: number;
    language?: string;
    chapters: SeedChapter[];
  },
) {
  const name = `Material ${position}`;
  const owned = { owner: STUDENT, course_id: COURSE, material_id: id };
  db.tables.materials.push({
    id,
    owner: STUDENT,
    course_id: COURSE,
    name,
    position,
    language,
    parse_status: "parsed",
  });
  let chapterPosition = 0;
  let chunkPosition = 0;
  const add = (
    chapter: SeedChapter,
    parentId: string | null,
    depth: number,
    root = false,
  ) => {
    const chapterId = crypto.randomUUID();
    db.tables.chapters.push({
      ...owned,
      id: chapterId,
      parent_id: parentId,
      position: chapterPosition++,
      depth,
      title: chapter.title,
      page_from: 1,
    });
    const chunks = chapter.chunks ?? (root ? [] : [`About ${chapter.title}.`]);
    for (const chunk of chunks) {
      const { markdown, label } =
        typeof chunk === "string"
          ? { markdown: chunk, label: undefined }
          : chunk;
      db.tables.chunks.push({
        ...owned,
        id: crypto.randomUUID(),
        chapter_id: chapterId,
        position: chunkPosition++,
        page_from: 1,
        page_to: 1,
        label: label ?? (chapter.exercise ? "exercise" : "content"),
        markdown,
        embedding: CHUNK_VECTOR,
      });
    }
    for (const child of chapter.children ?? []) {
      add(child, chapterId, depth + 1);
    }
  };
  add({ title: name, children: chapters }, null, 0, true);
  return id;
}

/**
 * What deleting a Material leaves: its Chapters, chunks, extractions and
 * the KC sources of its chunks are gone, as the foreign keys cascade.
 */
export function deleteMaterial(db: BuildDb, materialId: string) {
  const ofMaterial = (row: FakeRow) => row.material_id === materialId;
  const chapters = new Set(
    db.tables.chapters.filter(ofMaterial).map((c) => c.id),
  );
  const chunks = new Set(db.tables.chunks.filter(ofMaterial).map((c) => c.id));
  db.tables.materials = db.tables.materials.filter(
    (row) => row.id !== materialId,
  );
  db.tables.chapters = db.tables.chapters.filter((row) => !ofMaterial(row));
  db.tables.chunks = db.tables.chunks.filter((row) => !ofMaterial(row));
  db.tables.chapter_extractions = db.tables.chapter_extractions.filter(
    (row) => !chapters.has(row.chapter_id),
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

/**
 * Queues a build, as `queue_knowledge_map_build` does, keeping what the
 * stored Topic tree was built from.
 */
export function queueBuild(db: BuildDb) {
  const last = db.tables.knowledge_map_builds[0];
  db.tables.knowledge_map_builds = [
    {
      course_id: COURSE,
      owner: STUDENT,
      status: "building",
      failure_reason: null,
      finished_at: null,
      heartbeat_at: now(),
      topic_tree_hash: last?.topic_tree_hash ?? null,
    },
  ];
}

/** The stored Topic tree in tree order, as "name > parent name: KC names". */
export function topicTree(db: BuildDb): string[] {
  const topics = db.tables.topics.toSorted(
    (a, b) => Number(a.position) - Number(b.position),
  );
  const nameOf = (id: unknown) => topics.find((t) => t.id === id)?.name;
  const kcName = (id: unknown) => db.tables.kcs.find((k) => k.id === id)?.name;
  return topics.map((topic) => {
    const kcs = db.tables.topic_kcs
      .filter((row) => row.topic_id === topic.id)
      .toSorted((a, b) => Number(a.position) - Number(b.position))
      .map((row) => kcName(row.kc_id));
    const parent = topic.parent_id ? ` > ${nameOf(topic.parent_id)}` : "";
    return `${topic.name}${parent}: ${kcs.join(", ")}`;
  });
}

/** The live KCs' names in map order. */
export function liveKcs(db: BuildDb) {
  return db.tables.kcs
    .filter((kc) => !kc.retired_at)
    .toSorted((a, b) => Number(a.position) - Number(b.position))
    .map((kc) => kc.name);
}
