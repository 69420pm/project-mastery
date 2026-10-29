import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseMaterial } from "@/features/ingestion/server";
import { MATERIALS_BUCKET } from "@/lib/supabase/buckets";
import type { Json } from "@/lib/supabase/database.types";
import { result, type SmokeCheck, type SmokeResult } from "./smoke-check";

const GOLD = "evals/gold/linear-algebra-I";
const PDF = `${GOLD}/exercises.pdf`;

/** The recorded page results of `exercises.pdf`: Exercises 7–16 and solutions. */
type RecordedPage = {
  page_number: number;
  skipped: string | null;
  language: string | null;
  units: Array<{ label: string; exerciseNumber: string | null }>;
};

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
    const recording = JSON.parse(
      await readFile(`${GOLD}/pages.json`, "utf8"),
    ) as Record<string, RecordedPage[]>;
    const pages = recording["exercises.pdf"] ?? [];
    const page = (number: number) => {
      const found = pages.find((p) => p.page_number === number);
      if (!found) throw new Error(`pages.json has no page ${number}.`);
      return found;
    };
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
      const courseId = await createCourse(supabase, studentId, scenario.name);
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

async function createCourse(
  supabase: Supabase,
  studentId: string,
  name: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("courses")
    .insert({ owner: studentId, name: `Smoke pair: ${name}` })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

/**
 * A Material of the whole PDF whose given pages have their recorded
 * results, parsed with only those pages, so no page is read again.
 */
async function parseSeeded(
  {
    supabase,
    studentId,
    pdf,
  }: { supabase: Supabase; studentId: string; pdf: Uint8Array },
  courseId: string,
  name: string,
  pages: RecordedPage[],
) {
  const materialId = randomUUID();
  const storagePath = `${studentId}/${courseId}/${materialId}`;
  const upload = await supabase.storage
    .from(MATERIALS_BUCKET)
    .upload(storagePath, pdf, { contentType: "application/pdf" });
  if (upload.error) throw new Error(upload.error.message);
  const material = await supabase.from("materials").insert({
    id: materialId,
    owner: studentId,
    course_id: courseId,
    name,
    media_type: "application/pdf",
    size_bytes: pdf.byteLength,
    storage_path: storagePath,
  });
  if (material.error) throw new Error(material.error.message);
  const seeded = await supabase.from("material_pages").insert(
    pages.map((page) => ({
      owner: studentId,
      material_id: materialId,
      page_number: page.page_number,
      skipped: page.skipped,
      language: page.language,
      units: page.units as Json[],
    })),
  );
  if (seeded.error) throw new Error(seeded.error.message);
  await parseMaterial(materialId, {
    pages: pages.map((page) => page.page_number),
  });
}

async function pairingCalls(supabase: Supabase, studentId: string) {
  const { count, error } = await supabase
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("owner", studentId)
    .eq("task", "ingest");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

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
