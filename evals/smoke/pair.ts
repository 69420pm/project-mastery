import { readFile } from "node:fs/promises";
import {
  createCourse,
  GOLD,
  parseSeeded,
  recordedCalls,
  recordedPages,
} from "./recorded-pages";
import { result, type SmokeCheck, type SmokeResult } from "./smoke-check";

/** Recorded: Exercises 7–16 on page 3, solutions on page 5. */
const PDF = `${GOLD}/exercises.pdf`;

const EXERCISE_PAGE = 3;
const SOLUTION_PAGE = 5;

/**
 * The exercises whose solutions the recorded solution page prints. The
 * page also prints solutions to Exercises 3, 6, 18 and 21, which are on
 * pages not recorded, so they stay unpaired.
 */
const SOLVED = ["8", "9", "10", "14", "15"];
const UNSOLVED = ["7", "11", "12", "13", "16"];

type Smoke = Parameters<SmokeCheck["run"]>[0];
type Supabase = Smoke["supabase"];

/**
 * Pairing on the recorded gold exercise pages, through the real parse
 * workflow run in this process with the page results seeded, so the only
 * calls are the embeddings and pairing's content calls. Three Courses: the
 * pages as one Material; as the partners "Exercises" and "Exercises
 * Solutions"; and as those partners with the solutions' numbers removed.
 * Pinned to MiMo, the model that ships.
 */
export const pairSmoke: SmokeCheck = {
  name: "pair",
  model: "xiaomi/mimo-v2.6-flash",
  // 6 embedding calls (20 chunks each; the single Material has 22) and at
  // most 2 pairing calls.
  maxCalls: 8,
  usage: `pnpm smoke pair (the recorded pages ${EXERCISE_PAGE} and ${SOLUTION_PAGE} of ${PDF})`,
  async run({ supabase, studentId }) {
    const page = await recordedPages("exercises.pdf");
    const withoutNumbers = {
      ...page(SOLUTION_PAGE),
      units: page(SOLUTION_PAGE).units.map((unit) => ({
        ...unit,
        exerciseNumber: unit.label === "solution" ? null : unit.exerciseNumber,
      })),
    };
    const pdf = new Uint8Array(await readFile(PDF));
    const smoke = { supabase, studentId, pdf };

    const results: SmokeResult[] = [];
    const scenarios = [
      {
        name: "one Material",
        maxCalls: 0,
        materials: [
          {
            name: "exercises.pdf",
            pages: [page(EXERCISE_PAGE), page(SOLUTION_PAGE)],
          },
        ],
      },
      {
        name: "partners",
        maxCalls: 0,
        materials: [
          { name: "Exercises", pages: [page(EXERCISE_PAGE)] },
          { name: "Exercises Solutions", pages: [page(SOLUTION_PAGE)] },
        ],
      },
      {
        name: "partners without solution numbers",
        maxCalls: 2,
        materials: [
          { name: "Exercises", pages: [page(EXERCISE_PAGE)] },
          { name: "Exercises Solutions", pages: [withoutNumbers] },
        ],
      },
    ];
    for (const scenario of scenarios) {
      console.info(`Pairing ${scenario.name}…`);
      const before = await pairingCalls(supabase, studentId);
      const courseId = await createCourse(
        supabase,
        studentId,
        `Smoke pair: ${scenario.name}`,
      );
      for (const material of scenario.materials) {
        await parseSeeded(smoke, courseId, material.name, material.pages);
      }
      const calls = (await pairingCalls(supabase, studentId)) - before;
      results.push(
        ...(await checkPairs(supabase, courseId, scenario.name)),
        result(
          `${scenario.name}: at most ${scenario.maxCalls} pairing calls`,
          calls <= scenario.maxCalls,
          `${calls} calls`,
        ),
      );
    }
    return results;
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
  scenario: string,
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
  const got = new Map(
    pairs.data!.map((pair) => [
      numberOf.get(pair.exercise_chunk_id),
      pair.solution_chunk_id === null
        ? null
        : numberOf.get(pair.solution_chunk_id),
    ]),
  );
  const expected = new Map<string, string | null>([
    ...SOLVED.map((n) => [n, n] as const),
    ...UNSOLVED.map((n) => [n, null] as const),
  ]);
  const wrong = [...expected].filter(
    ([n, solution]) => got.get(n) !== solution,
  );
  const failedParses = materials.data!.filter(
    (m) => m.parse_status !== "parsed",
  );
  console.info(
    `  ${[...got].map(([e, s]) => `${e}→${s ?? "none"}`).join(", ")}`,
  );
  return [
    result(
      `${scenario}: every Material is parsed`,
      failedParses.length === 0,
      failedParses.map((m) => `${m.name}: ${m.parse_failure}`).join("; ") ||
        undefined,
    ),
    result(
      `${scenario}: Exercises ${SOLVED.join(", ")} get their printed solutions, ${UNSOLVED.join(", ")} none`,
      wrong.length === 0 && got.size === expected.size,
      wrong
        .map(([n]) => `Exercise ${n} got ${got.get(n) ?? "none"}`)
        .join("; ") || undefined,
    ),
  ];
}
