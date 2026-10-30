import { readFile } from "node:fs/promises";
import { buildKnowledgeMap } from "@/features/knowledge-map/server";
import {
  createCourse,
  GOLD,
  parseSeeded,
  recordedCalls,
  recordedPages,
  type RecordedPage,
} from "./recorded-pages";
import { result, type SmokeCheck, type SmokeResult } from "./smoke-check";

type Supabase = Parameters<SmokeCheck["run"]>[0]["supabase"];

/** The recorded lecture pages: Chapter 4, Vector Spaces. */
const LECTURE_PAGES = [19, 20, 21, 22];
const EXERCISE_PAGE = 3;
const SOLUTION_PAGE = 5;
/** The Exercises kept from the recorded exercise pages. */
const KEPT = ["7", "8", "9", "10"];
/** The most calls of the first Update map. */
const MAX_BUILD_CALLS = 14;

/**
 * Update map from the recorded gold pages (#222): the lecture notes'
 * Vector Spaces pages and Exercises 7–10 with their printed solutions,
 * parsed without page calls, then built twice with the real workflow in
 * this process. Pinned to MiMo, the model that ships; it may take 10
 * minutes (`AI_SMOKE_MAX_MINUTES=10`).
 */
export const mapSmoke: SmokeCheck = {
  name: "map",
  model: "xiaomi/mimo-v2.6-flash",
  // The parse's chunk embeddings, then the first build's calls.
  maxCalls: MAX_BUILD_CALLS + 4,
  usage: `pnpm smoke map (Update map from the recorded pages ${LECTURE_PAGES.join(", ")} of ${GOLD}/lecture-notes.pdf and Exercises ${KEPT.join(", ")}; AI_SMOKE_MAX_MINUTES=10)`,
  async run({ supabase, studentId }) {
    const lecture = await recordedPages("lecture-notes.pdf");
    const exercisePage = await recordedPages("exercises.pdf");
    const kept = (page: RecordedPage, label: string): RecordedPage => ({
      ...page,
      units: page.units.filter(
        (unit) =>
          unit.label === label && KEPT.includes(unit.exerciseNumber ?? ""),
      ),
    });
    const courseId = await createCourse(supabase, studentId, "Smoke map");
    for (const [file, name, pages] of [
      [
        "lecture-notes.pdf",
        "Lecture notes",
        LECTURE_PAGES.map((number) => lecture(number)),
      ],
      [
        "exercises.pdf",
        "Exercises",
        [
          kept(exercisePage(EXERCISE_PAGE), "exercise"),
          kept(exercisePage(SOLUTION_PAGE), "solution"),
        ],
      ],
    ] as const) {
      const pdf = new Uint8Array(await readFile(`${GOLD}/${file}`));
      await parseSeeded({ supabase, studentId, pdf }, courseId, name, [
        ...pages,
      ]);
    }

    const parsed = await recordedCalls(supabase, studentId);
    console.info("Updating the map…");
    await update(supabase, courseId, studentId);
    const built = await recordedCalls(supabase, studentId);
    const results = await checkMap(supabase, courseId);
    console.info("Updating the map again…");
    await update(supabase, courseId, studentId);
    const again = await recordedCalls(supabase, studentId);
    return [
      ...results,
      result(
        `the first Update map makes at most ${MAX_BUILD_CALLS} calls`,
        built - parsed <= MAX_BUILD_CALLS,
        `${built - parsed} calls`,
      ),
      result(
        "a second Update map makes no call",
        again === built,
        `${again - built} calls`,
      ),
    ];
  },
};

/**
 * Queues a build as `queue_knowledge_map_build` would (it needs a signed-in
 * Student) and runs it.
 */
async function update(supabase: Supabase, courseId: string, owner: string) {
  const { error } = await supabase.from("knowledge_map_builds").upsert(
    {
      course_id: courseId,
      owner,
      status: "building",
      failure_reason: null,
      heartbeat_at: new Date().toISOString(),
    },
    { onConflict: "course_id" },
  );
  if (error) throw new Error(error.message);
  await buildKnowledgeMap(courseId);
}

async function checkMap(
  supabase: Supabase,
  courseId: string,
): Promise<SmokeResult[]> {
  const [build, bigIdeas, topics, extractions, chunks, exercises] =
    await Promise.all([
      supabase
        .from("knowledge_map_builds")
        .select("status, failure_reason, check_report")
        .eq("course_id", courseId)
        .single(),
      supabase.from("big_ideas").select("name").eq("course_id", courseId),
      supabase
        .from("topics")
        .select("name, central_question")
        .eq("course_id", courseId)
        .order("position"),
      supabase
        .from("part_extractions")
        .select("part_id, output")
        .eq("course_id", courseId),
      supabase
        .from("chunks")
        .select("id, part_id, exercise_number")
        .eq("course_id", courseId),
      supabase
        .from("exercises")
        .select("question_chunk_id, final_answers")
        .eq("course_id", courseId),
    ]);
  for (const { error } of [build, bigIdeas, topics, extractions, chunks]) {
    if (error) throw new Error(error.message);
  }
  if (exercises.error) throw new Error(exercises.error.message);
  const report = build.data!.check_report as {
    kcsPerPart: Array<{ part: string; kcs: number; budget: number }>;
  } | null;
  const partOf = new Map(chunks.data!.map((c) => [c.id, c.part_id]));
  const strays = extractions.data!.flatMap((row) =>
    (row.output as { kcs: Array<{ name: string; chunkIds: string[] }> }).kcs
      .filter((kc) => kc.chunkIds.some((id) => partOf.get(id) !== row.part_id))
      .map((kc) => kc.name),
  );
  const overBudget = (report?.kcsPerPart ?? []).filter(
    (part) => part.kcs > part.budget,
  );
  const numberOf = new Map(
    chunks.data!.map((c) => [c.id, /\d+/.exec(c.exercise_number ?? "")?.[0]]),
  );
  const answers = new Map(
    exercises.data.map((exercise) => [
      numberOf.get(exercise.question_chunk_id),
      ((exercise.final_answers ?? []) as Array<{ value: number }>).map(
        (answer) => answer.value,
      ),
    ]),
  );
  const names = bigIdeas.data!.map((row) => row.name);
  console.info(`  Big ideas: ${names.join("; ")}`);
  for (const topic of topics.data!) {
    console.info(`  Topic: ${topic.name} — ${topic.central_question}`);
  }
  console.info(
    `  Final answers: ${[...answers].map(([n, v]) => `${n}: ${v.join(", ") || "none"}`).join("; ")}`,
  );
  console.info(`  Check report: ${JSON.stringify(report)}`);
  return [
    result(
      "the map is built",
      build.data!.status === "built",
      build.data!.failure_reason ?? undefined,
    ),
    result(
      "every KC cites a chunk of its Part",
      strays.length === 0,
      strays.join("; ") || undefined,
    ),
    result(
      "no Part exceeds its KC budget",
      report !== null && overBudget.length === 0,
      overBudget
        .map((part) => `${part.part}: ${part.kcs} > ${part.budget}`)
        .join("; ") || undefined,
    ),
    result(
      'the Big idea is "Vector Spaces"',
      names.length === 1 && /vector spaces/i.test(names[0] ?? ""),
      names.join("; "),
    ),
    result(
      "the map has Topics",
      topics.data!.length > 0,
      `${topics.data!.length} Topics`,
    ),
    result(
      "Exercise 7's final answer is the printed 8, Exercise 10's the printed dim U = 2, Exercises 8 and 9 have none",
      String(answers.get("7")) === "8" &&
        String(answers.get("10")) === "2" &&
        answers.get("8")?.length === 0 &&
        answers.get("9")?.length === 0,
      [...answers].map(([n, v]) => `${n}: ${v.join(", ")}`).join("; "),
    ),
  ];
}
