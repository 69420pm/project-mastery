/**
 * Exports a real course from the local database as the `generate-real`
 * dataset:
 *
 *   pnpm evals:export-generate <courseId>
 *
 * It writes `evals/datasets/private/generate-real.json`, which git ignores:
 * the repository is public and the course is a Student's material, so the
 * file must never be committed. Up to 10 variants (Exercises with a question)
 * and 10 new Problems (the first two KCs of a Topic each, difficulty 2), each
 * as the full call input, the way the workflow builds it. Reads the course
 * with the admin client, like the smoke checks; no model call.
 */
// Must come first: lets this script import modules that use Next.js.
import "../next-aliases";
import { mkdir, writeFile } from "node:fs/promises";
import {
  loadChunkSources,
  loadExerciseSolutions,
} from "@/features/ingestion/server";
import {
  loadStoredMap,
  loadStoredTopics,
} from "@/features/knowledge-map/server";
import { createAdminClient } from "@/lib/supabase/admin";

const FILE = "evals/datasets/private/generate-real.json";
const PER_KIND = 10;
const SOURCES_PER_KC = 3;
const STYLE_ANCHORS = 2;

async function main() {
  const [courseId] = process.argv.slice(2);
  if (!courseId) {
    throw new Error("Usage: pnpm evals:export-generate <courseId>");
  }
  const supabase = createAdminClient();
  const map = await loadStoredMap(supabase, courseId);
  const topics = await loadStoredTopics(supabase, courseId);
  const paired = await loadExerciseSolutions(supabase, courseId);
  const kcById = new Map(map.kcs.map((kc) => [kc.id, kc]));
  const describe = (id: string) => {
    const kc = kcById.get(id);
    return kc ? [{ name: kc.name, description: kc.description }] : [];
  };

  const newKcs = topics
    .slice(0, PER_KIND)
    .map(({ kcs }) => kcs.slice(0, 2).map(String));
  const exercises = map.exercises.slice(0, PER_KIND);
  const chunkIds = [
    ...exercises.flatMap(({ questionChunk }) => [
      questionChunk,
      ...(paired[questionChunk] ? [paired[questionChunk]] : []),
    ]),
    ...newKcs.flatMap((ids) =>
      ids.flatMap(
        (id) => kcById.get(id)?.sources.slice(0, SOURCES_PER_KC) ?? [],
      ),
    ),
    ...map.exercises
      .slice(0, STYLE_ANCHORS)
      .map(({ questionChunk }) => questionChunk),
  ];
  const chunks = await loadChunkSources(supabase, chunkIds);
  const markdown = (id: string | null | undefined) =>
    chunks.find((chunk) => chunk.id === id)?.markdown ?? null;

  const variants = exercises.flatMap((exercise, i) => {
    const question = markdown(exercise.questionChunk);
    if (question === null) return [];
    return [
      {
        id: `variant-${i + 1}`,
        input: {
          kind: "given",
          input: {
            kind: "variant",
            exercise: {
              question,
              solution:
                exercise.solution ?? markdown(paired[exercise.questionChunk]),
              finalAnswers: exercise.finalAnswers ?? null,
              taskType: exercise.taskType,
              difficulty: exercise.difficulty,
            },
            kcs: exercise.kcs.flatMap(describe),
          },
        },
        expectedOutput: null,
      },
    ];
  });
  const anchors = map.exercises.slice(0, STYLE_ANCHORS).flatMap((exercise) => {
    const question = markdown(exercise.questionChunk);
    return question === null ? [] : [{ question, taskType: exercise.taskType }];
  });
  const news = newKcs.map((ids, i) => ({
    id: `new-${i + 1}`,
    input: {
      kind: "given",
      input: {
        kind: "new",
        kcs: ids.flatMap((id) => {
          const kc = kcById.get(id);
          return kc
            ? [
                {
                  name: kc.name,
                  description: kc.description,
                  sources: kc.sources
                    .slice(0, SOURCES_PER_KC)
                    .flatMap((source) => markdown(source) ?? []),
                },
              ]
            : [];
        }),
        difficulty: 2,
        styleAnchors: anchors,
      },
    },
    expectedOutput: null,
  }));

  await mkdir("evals/datasets/private", { recursive: true });
  await writeFile(
    FILE,
    JSON.stringify(
      {
        description: `A real course (${courseId}), exported ${new Date().toISOString().slice(0, 10)}. Never commit this file.`,
        items: [...variants, ...news],
      },
      null,
      2,
    ),
  );
  console.info(
    `Wrote ${FILE}: ${variants.length} variants, ${news.length} new Problems. The file is gitignored; never commit it.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
