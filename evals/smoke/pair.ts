import { readFile } from "node:fs/promises";
import {
  createCourse,
  GOLD,
  parseSeeded,
  recordedCalls,
  recordedOutline,
  recordedPages,
} from "./recorded-pages";
import { result, type SmokeCheck, type SmokeResult } from "./smoke-check";

/** Recorded: Exercises 7–16 on page 3, solutions on page 5. */
const FILE = "exercises.pdf";
const PDF = `${GOLD}/${FILE}`;

const EXERCISE_PAGE = 3;
const SOLUTION_PAGE = 5;

/**
 * The exercises whose solutions the recorded solution page prints. The
 * page also prints solutions to Exercises 3, 6, 18 and 21, which are on
 * pages not recorded, so they pair with nothing.
 */
const SOLVED = ["8", "9", "10", "14", "15"];

type Smoke = Parameters<SmokeCheck["run"]>[0];
type Supabase = Smoke["supabase"];

/**
 * Pairing on the recorded gold exercise pages, through the real parse
 * workflow run in this process with the page results and the Outline
 * seeded, so the only calls are the embeddings and the Course's one pairing
 * call. On the default smoke model (AI_SMOKE_MODEL pins another).
 */
export const pairSmoke: SmokeCheck = {
  name: "pair",
  // 1 or 2 embedding calls (20 chunks each) and 1 pairing call.
  maxCalls: 3,
  usage: `pnpm smoke pair (the recorded pages ${EXERCISE_PAGE} and ${SOLUTION_PAGE} of ${PDF})`,
  async run({ supabase, studentId }) {
    const page = await recordedPages(FILE);
    const pdf = new Uint8Array(await readFile(PDF));
    const before = await pairingCalls(supabase, studentId);
    const courseId = await createCourse(supabase, studentId, "Smoke pair");
    await parseSeeded(
      { supabase, studentId, pdf },
      courseId,
      FILE,
      [page(EXERCISE_PAGE), page(SOLUTION_PAGE)],
      await recordedOutline(FILE),
    );
    const calls = (await pairingCalls(supabase, studentId)) - before;
    return [
      ...(await checkPairs(supabase, courseId)),
      result("one pairing call", calls === 1, `${calls} calls`),
    ];
  },
};

const pairingCalls = (supabase: Supabase, studentId: string) =>
  recordedCalls(supabase, studentId, "ingest");

/** The exercise number a chunk prints, as "Exercise 8" or "Solution to Exercise 8". */
const printedNumber = (markdown: string) =>
  /Exercise (\d+)/.exec(markdown)?.[1] ?? null;

async function checkPairs(
  supabase: Supabase,
  courseId: string,
): Promise<SmokeResult[]> {
  const [chunks, pairs, materials] = await Promise.all([
    supabase
      .from("chunks")
      .select("id, label, markdown")
      .eq("course_id", courseId)
      .in("label", ["exercise", "solution"]),
    supabase
      .from("exercise_solutions")
      .select("exercise_chunk_id, solution_chunk_id")
      .eq("course_id", courseId),
    supabase
      .from("materials")
      .select("name, parse_status, parse_failure")
      .eq("course_id", courseId),
  ]);
  for (const { error } of [chunks, pairs, materials]) {
    if (error) throw new Error(error.message);
  }
  const numberOf = new Map(
    chunks.data!.map((chunk) => [chunk.id, printedNumber(chunk.markdown)]),
  );
  const exercises = chunks.data!.filter((chunk) => chunk.label === "exercise");
  const solutionOf = new Map(
    pairs.data!.map((pair) => [pair.exercise_chunk_id, pair.solution_chunk_id]),
  );
  // Each exercise chunk: its printed number (none for the end of Exercise
  // 7, carried over from page 2) and the number its solution prints.
  const got = exercises.map((exercise) => {
    const solution = solutionOf.get(exercise.id);
    return {
      exercise: numberOf.get(exercise.id) ?? "(no number)",
      solution: solution ? (numberOf.get(solution) ?? "(no number)") : null,
      hasRow: solutionOf.has(exercise.id),
    };
  });
  const wrong = got.filter(
    ({ exercise, solution, hasRow }) =>
      !hasRow || solution !== (SOLVED.includes(exercise) ? exercise : null),
  );
  const failedParses = materials.data!.filter(
    (m) => m.parse_status !== "parsed",
  );
  console.info(
    `  ${got.map(({ exercise, solution }) => `${exercise}→${solution ?? "none"}`).join(", ")}`,
  );
  return [
    result(
      "the Material is parsed",
      failedParses.length === 0,
      failedParses.map((m) => `${m.name}: ${m.parse_failure}`).join("; ") ||
        undefined,
    ),
    result(
      `Exercises ${SOLVED.join(", ")} get their printed solutions, the others none`,
      wrong.length === 0 && got.length > 0,
      wrong
        .map(
          ({ exercise, solution, hasRow }) =>
            `Exercise ${exercise} got ${hasRow ? (solution ?? "none") : "no pair row"}`,
        )
        .join("; ") || undefined,
    ),
  ];
}
