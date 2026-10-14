import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

/**
 * Test helpers for the build workflow in-process (`build-knowledge-map.ts`):
 * the admin client as a `fakeSupabase`. `apply_knowledge_map_update` stands
 * in for the database function, which pgTAP tests: while the build runs, it
 * makes the stored big ideas, KCs, sources, links, Exercises and Findings
 * the map's, keeping rows whose ids the map names and giving new ones random
 * ids, records the processed chunks and marks the build built.
 */
export function createMapDb(courseId: string) {
  return fakeSupabase({
    tables: {
      materials: [] as FakeRow[],
      chunks: [] as FakeRow[],
      knowledge_map_builds: [] as FakeRow[],
      knowledge_map_chunks: [] as FakeRow[],
      big_ideas: [] as FakeRow[],
      kcs: [] as FakeRow[],
      kc_sources: [] as FakeRow[],
      prerequisite_links: [] as FakeRow[],
      semantic_links: [] as FakeRow[],
      exercise_solutions: [] as FakeRow[],
      exercises: [] as FakeRow[],
      exercise_kcs: [] as FakeRow[],
      findings: [] as FakeRow[],
      finding_sources: [] as FakeRow[],
      ai_usage: [] as FakeRow[],
    },
    defaults: { ai_usage: () => ({ created_at: new Date().toISOString() }) },
    functions: {
      apply_knowledge_map_update: (args, tables) => {
        const build = tables.knowledge_map_builds.find(
          (row) =>
            row.course_id === args.p_course_id && row.status === "building",
        );
        if (!build) return false;
        const map = args.p_map as {
          bigIdeas: Array<FakeRow & { id: string; name: string }>;
          kcs: Array<
            FakeRow & { id: string; bigIdea: string | null; sources: string[] }
          >;
          prerequisites: Array<{
            from: string;
            to: string;
            extractionConfidence: number;
          }>;
          semanticLinks: Array<{
            from: string;
            to: string;
            coreType: string;
            label: string;
          }>;
          exercises: Array<FakeRow & { id: string; kcs: string[] }>;
          findings: Array<{
            id?: string;
            kind: string;
            text: string;
            sources: string[];
          }>;
        };
        const chunkIds = new Set(tables.chunks.map((chunk) => chunk.id));
        // A stored row's id stays and its row is kept as it is.
        const ids = new Map<string, string>();
        const rowId = (id: string) => {
          if (!ids.has(id)) ids.set(id, crypto.randomUUID());
          return ids.get(id) ?? id;
        };
        for (const table of [
          tables.big_ideas,
          tables.kcs,
          tables.exercises,
          tables.findings,
        ]) {
          for (const row of table) ids.set(String(row.id), String(row.id));
        }
        const keep = (rows: FakeRow[], id: unknown, fresh: () => FakeRow) =>
          rows.find((row) => row.id === id) ?? fresh();
        const findingIds = map.findings.map((finding) =>
          finding.id ? rowId(finding.id) : crypto.randomUUID(),
        );
        tables.big_ideas = map.bigIdeas.map((bigIdea, position) =>
          keep(tables.big_ideas, bigIdea.id, () => ({
            id: rowId(bigIdea.id),
            course_id: courseId,
            name: bigIdea.name,
            description: bigIdea.description,
            position,
          })),
        );
        tables.prerequisite_links = map.prerequisites.map((link, index) => ({
          id: index,
          course_id: courseId,
          from_kc: rowId(link.from),
          to_kc: rowId(link.to),
          extraction_confidence: link.extractionConfidence,
        }));
        tables.semantic_links = map.semanticLinks.map((link, index) => ({
          id: index,
          course_id: courseId,
          from_kc: rowId(link.from),
          to_kc: rowId(link.to),
          core_type: link.coreType,
          label: link.label,
        }));
        tables.kcs = map.kcs.map((kc, position) =>
          keep(tables.kcs, kc.id, () => ({
            id: rowId(kc.id),
            course_id: courseId,
            big_idea_id: kc.bigIdea && rowId(kc.bigIdea),
            name: kc.name,
            description: kc.description,
            type: kc.type,
            bloom: kc.bloom,
            origin: kc.origin,
            position,
          })),
        );
        tables.kc_sources = map.kcs.flatMap((kc) =>
          kc.sources
            .filter((chunkId) => chunkIds.has(chunkId))
            .map((chunkId) => ({
              course_id: courseId,
              kc_id: rowId(kc.id),
              chunk_id: chunkId,
            })),
        );
        tables.exercises = map.exercises.map((exercise, position) =>
          keep(tables.exercises, exercise.id, () => ({
            id: rowId(exercise.id),
            course_id: courseId,
            question_chunk_id: exercise.questionChunk,
            name: exercise.name,
            task_type: exercise.taskType,
            solution_status: exercise.solutionStatus,
            solution: exercise.solution,
            difficulty: exercise.difficulty,
            position,
          })),
        );
        tables.exercise_kcs = map.exercises.flatMap((exercise) =>
          exercise.kcs.map((kcId) => ({
            course_id: courseId,
            exercise_id: rowId(exercise.id),
            kc_id: rowId(kcId),
          })),
        );
        tables.findings = map.findings.map((finding, position) =>
          keep(tables.findings, finding.id, () => ({
            id: findingIds[position],
            course_id: courseId,
            kind: finding.kind,
            text: finding.text,
            position,
          })),
        );
        tables.finding_sources = map.findings.flatMap((finding, position) =>
          finding.sources
            .filter((chunkId) => chunkIds.has(chunkId))
            .map((chunkId) => ({
              course_id: courseId,
              finding_id: findingIds[position],
              chunk_id: chunkId,
            })),
        );
        for (const chunkId of args.p_chunk_ids as string[]) {
          if (chunkIds.has(chunkId)) {
            tables.knowledge_map_chunks.push({
              course_id: courseId,
              chunk_id: chunkId,
            });
          }
        }
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

type MapDb = ReturnType<typeof createMapDb>;

export const STUDENT = "11111111-1111-1111-1111-111111111111";

/**
 * A Material of the Course with chunks of these labels and markdown, one per
 * page; returns their ids.
 */
export function seedMaterial(
  db: MapDb,
  courseId: string,
  name: string,
  parseStatus: string,
  chunks: Array<
    [label: string, markdown: string, exerciseNumber?: string | null]
  >,
) {
  const materialId = crypto.randomUUID();
  db.tables.materials.push({
    id: materialId,
    owner: STUDENT,
    course_id: courseId,
    name,
    parse_status: parseStatus,
  });
  return chunks.map(([label, markdown, exerciseNumber = null], position) => {
    const id = crypto.randomUUID();
    db.tables.chunks.push({
      id,
      material_id: materialId,
      course_id: courseId,
      position,
      page_from: position + 1,
      label,
      markdown,
      exercise_number: exerciseNumber,
    });
    return id;
  });
}

/** A running build of the Course. */
export function seedBuild(db: MapDb, courseId: string) {
  db.tables.knowledge_map_builds.push({
    course_id: courseId,
    owner: STUDENT,
    status: "building",
    failure_reason: null,
  });
}

/** What a model call was sent. */
export type Sent = Record<string, unknown> & {
  kcs?: Array<{ id: string; name: string }>;
  chunks?: Array<{ id: string; markdown: string }>;
};

/**
 * The `map` and `exercise` model: answers the skeleton with the test's
 * skeleton (or its function of what was sent), each assignment with the
 * test's function of the call's number, each fill with every KC filled, the
 * links calls with the test's links (or its function of what was sent) or
 * none, each exercise call with the test's function or a plain answer, and
 * the merge call with the test's function or each cluster merged whole, and
 * the scope call with the test's function or no remarks.
 * Remembers what each call was sent. Its `embed` model gives KCs named in
 * one `alike` group the same vector and every other KC its own; `models`
 * is what `useMockModels` takes.
 */
export function mapModel(answers: {
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
  exercise?: (input: Sent) => unknown;
  /** Groups of KC names that embed alike; every other KC is apart. */
  alike?: string[][];
  /** The merge call's answer; by default each cluster is one KC. */
  merge?: (input: Sent) => unknown;
  /** The scope call's answer; by default no remarks. */
  scope?: (input: Sent) => unknown;
}) {
  const sent: Sent[] = [];
  const embedded: string[][] = [];
  const axes: string[] = [];
  const axis = (kcName: string) => {
    const key =
      answers.alike?.find((group) => group.includes(kcName))?.[0] ?? kcName;
    if (!axes.includes(key)) axes.push(key);
    return axes.indexOf(key);
  };
  const embed = new MockEmbeddingModelV4({
    doEmbed: async ({ values }) => {
      embedded.push(values);
      return {
        embeddings: values.map((text) => {
          const vector = Array.from({ length: 64 }, () => 0);
          vector[axis(text.slice(0, text.indexOf(":")))] = 1;
          return vector;
        }),
        usage: undefined,
        warnings: [],
      };
    },
  });
  let assignments = 0;
  const orCall = (answer: unknown, input: Sent) =>
    typeof answer === "function"
      ? (answer as (input: Sent) => unknown)(input)
      : answer;
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const message = prompt.findLast((m) => m.role === "user");
      const input = JSON.parse(
        (message?.content as Array<{ text: string }>)[0]?.text ?? "{}",
      ) as Sent;
      sent.push(input);
      let answer: unknown;
      if ("adminChunks" in input) {
        answer = answers.scope?.(input) ?? { remarks: [] };
      } else if ("clusters" in input) {
        const clusters = input.clusters as Array<{
          id: string;
          kcs: Array<{ id: string }>;
        }>;
        answer = answers.merge?.(input) ?? {
          clusters: Object.fromEntries(
            clusters.map((cluster) => [
              cluster.id,
              { groups: [cluster.kcs.map((kc) => kc.id)] },
            ]),
          ),
        };
      } else if ("exercise" in input) {
        answer = answers.exercise?.(input) ?? {
          kcIds: [],
          newKcs: [],
          taskType: "compute",
          solution: "Solved.",
          finalResult: "1",
          steps: 1,
        };
      } else if ("definitions" in input) {
        answer = orCall(answers.skeleton, input);
      } else if ("chunks" in input) {
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
      } else if (!("bigIdea" in input)) {
        answer = orCall(answers.links, input) ?? {
          prerequisites: [],
          semanticLinks: [],
          priorKcs: [],
        };
      } else {
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
      }
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
  return {
    model,
    sent,
    embedded,
    models: { map: model, exercise: model, embed },
  };
}
