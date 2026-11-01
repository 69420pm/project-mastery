import { readFile } from "node:fs/promises";
import { buildKnowledgeMap } from "@/features/knowledge-map/server";
import {
  createCourse,
  GOLD,
  parseSeeded,
  recordedCalls,
  recordedOutline,
  recordedPages,
  type RecordedPage,
} from "./recorded-pages";
import { result, type SmokeCheck, type SmokeResult } from "./smoke-check";

type Supabase = Parameters<SmokeCheck["run"]>[0]["supabase"];

/**
 * The recorded lecture pages: the end of Chapter 3 and Chapter 4, Vector
 * Spaces. All of them, so the recorded Outline's heading ids still match.
 */
const LECTURE_PAGES = [17, 18, 19, 20, 21, 22, 23, 24];
const EXERCISE_PAGE = 3;
const SOLUTION_PAGE = 5;
/** The Exercises kept from the recorded exercise pages. */
const KEPT = [7, 8, 9, 10];
/** The most generating calls of the first Update map; embeddings aside. */
const MAX_BUILD_CALLS = 10;

/** The exercise number a unit or chunk prints first, as in "Exercise 8". */
const printedNumber = (markdown: unknown) => {
  const found = /Exercise (\d+)/.exec(String(markdown))?.[1];
  return found === undefined ? null : Number(found);
};

/**
 * The recorded exercise page up to Exercise 10, with the "8.3 Vector
 * spaces" heading between, and the solution page's solutions to Exercises
 * 7–10.
 */
function keptExercises(exercises: RecordedPage, solutions: RecordedPage) {
  const after = exercises.units.findIndex(
    (unit) => (printedNumber(unit.markdown) ?? 0) > KEPT.at(-1)!,
  );
  return [
    { ...exercises, units: exercises.units.slice(0, after) },
    {
      ...solutions,
      units: solutions.units.filter((unit) =>
        KEPT.includes(printedNumber(unit.markdown) ?? 0),
      ),
    },
  ];
}

/**
 * Update map from the recorded gold pages (#229): the lecture notes' pages
 * 17–24 and Exercises 7–10 with their printed solutions, parsed with their
 * recorded Outlines and without page calls, then built twice with the real
 * workflow in this process. Pinned to MiMo, the model that ships; it may
 * take 10 minutes (`AI_SMOKE_MAX_MINUTES=10`).
 */
export const mapSmoke: SmokeCheck = {
  name: "map",
  model: "xiaomi/mimo-v2.6-flash",
  // The parse's chunk embeddings and pairing call, the first build's calls
  // and its KC embeddings.
  maxCalls: MAX_BUILD_CALLS + 8,
  usage: `pnpm smoke map (Update map from the recorded pages ${LECTURE_PAGES[0]}–${LECTURE_PAGES.at(-1)} of ${GOLD}/lecture-notes.pdf and Exercises ${KEPT.join(", ")}; AI_SMOKE_MAX_MINUTES=10)`,
  async run({ supabase, studentId }) {
    const lecture = await recordedPages("lecture-notes.pdf");
    const exercisePage = await recordedPages("exercises.pdf");
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
        keptExercises(exercisePage(EXERCISE_PAGE), exercisePage(SOLUTION_PAGE)),
      ],
    ] as const) {
      const pdf = new Uint8Array(await readFile(`${GOLD}/${file}`));
      await parseSeeded(
        { supabase, studentId, pdf },
        courseId,
        name,
        pages,
        await recordedOutline(file),
      );
    }

    const generating = async () =>
      (await recordedCalls(supabase, studentId)) -
      (await recordedCalls(supabase, studentId, "embed"));
    const parsed = await generating();
    console.info("Updating the map…");
    await update(supabase, courseId, studentId);
    const built = await generating();
    const allBuilt = await recordedCalls(supabase, studentId);
    const results = await checkMap(supabase, courseId);
    console.info("Updating the map again…");
    await update(supabase, courseId, studentId);
    const again = await recordedCalls(supabase, studentId);
    return [
      ...results,
      result(
        `the first Update map makes at most ${MAX_BUILD_CALLS} calls, embeddings aside`,
        built - parsed <= MAX_BUILD_CALLS,
        `${built - parsed} calls`,
      ),
      result(
        "a second Update map makes no call",
        again === allBuilt,
        `${again - allBuilt} calls`,
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

/** A stored Topic as the check reads it. */
type StoredTopic = {
  id: string;
  parent_id: string | null;
  name: string;
  central_question: string | null;
  chapter_ids: string[];
};

/**
 * Common English words, one of which every English description has, and
 * common German and French words, which none has.
 */
const ENGLISH = /\b(the|of|a|an|is|are|and|to|in|for|with|by)\b/i;
const NOT_ENGLISH = /\b(der|die|das|und|ist|ein|eine|nicht|le|la|les|est)\b/i;

async function checkMap(
  supabase: Supabase,
  courseId: string,
): Promise<SmokeResult[]> {
  const [build, topics, chapters, extractions, chunks, kcs, exercises] =
    await Promise.all([
      supabase
        .from("knowledge_map_builds")
        .select("status, failure_reason, check_report")
        .eq("course_id", courseId)
        .single(),
      supabase
        .from("topics")
        .select("id, parent_id, name, central_question, chapter_ids")
        .eq("course_id", courseId)
        .order("position"),
      supabase
        .from("chapters")
        .select("id, parent_id, position, title, materials(name)")
        .eq("course_id", courseId),
      supabase
        .from("chapter_extractions")
        .select("chapter_id, output")
        .eq("course_id", courseId),
      supabase
        .from("chunks")
        .select("id, chapter_id, markdown")
        .eq("course_id", courseId),
      supabase
        .from("kcs")
        .select("name, description")
        .eq("course_id", courseId)
        .is("retired_at", null),
      supabase
        .from("exercises")
        .select("question_chunk_id, final_answers")
        .eq("course_id", courseId),
    ]);
  for (const { error } of [build, topics, chapters, extractions, chunks]) {
    if (error) throw new Error(error.message);
  }
  for (const { error } of [kcs, exercises]) {
    if (error) throw new Error(error.message);
  }

  // A unit's chunks lie in its Chapter's subtree, so a KC citing a chunk
  // outside that subtree cites one outside its unit.
  const parentOf = new Map(chapters.data!.map((c) => [c.id, c.parent_id]));
  const inSubtree = (chapterId: string | null, root: string): boolean =>
    chapterId !== null &&
    (chapterId === root || inSubtree(parentOf.get(chapterId) ?? null, root));
  const chapterOf = new Map(chunks.data!.map((c) => [c.id, c.chapter_id]));
  const strays = extractions.data!.flatMap((row) =>
    (row.output as { kcs: Array<{ name: string; chunkIds: string[] }> }).kcs
      .filter(
        (kc) =>
          kc.chunkIds.length === 0 ||
          kc.chunkIds.some(
            (id) => !inSubtree(chapterOf.get(id) ?? null, row.chapter_id),
          ),
      )
      .map((kc) => kc.name),
  );
  const notEnglish = kcs.data!.filter(
    (kc) => !ENGLISH.test(kc.description) || NOT_ENGLISH.test(kc.description),
  );

  // The lecture notes' Chapters in reading order, and each Topic's first.
  const lectureChapters = new Map(
    chapters
      .data!.filter((c) => c.materials?.name === "Lecture notes")
      .map((c) => [c.id, c]),
  );
  const childrenOf = (id: string | null) =>
    topics.data!.filter((topic) => topic.parent_id === id);
  const firstChapter = (topic: StoredTopic): number =>
    Math.min(
      ...topic.chapter_ids.flatMap((id) => {
        const chapter = lectureChapters.get(id);
        return chapter ? [chapter.position] : [];
      }),
      ...childrenOf(topic.id).map(firstChapter),
    );
  const vectorSpaces = childrenOf(null).find((topic) =>
    /vector spaces/i.test(topic.name),
  );
  const sections = vectorSpaces ? childrenOf(vectorSpaces.id) : [];
  const starts = sections.map(firstChapter);
  const inOrder =
    sections.length >= 2 &&
    starts.every((start, i) => i === 0 || start > starts[i - 1]!);

  const numberOf = new Map(
    chunks.data!.map((c) => [c.id, printedNumber(c.markdown)]),
  );
  const answers = new Map(
    exercises.data!.map((exercise) => [
      numberOf.get(exercise.question_chunk_id),
      ((exercise.final_answers ?? []) as Array<{ value: number }>).map(
        (answer) => answer.value,
      ),
    ]),
  );

  const depthOf = (topic: StoredTopic): number =>
    topic.parent_id === null
      ? 0
      : 1 + depthOf(topics.data!.find((t) => t.id === topic.parent_id)!);
  for (const topic of topics.data!) {
    console.info(
      `  ${"  ".repeat(depthOf(topic))}Topic: ${topic.name}${topic.central_question ? ` — ${topic.central_question}` : ""}`,
    );
  }
  console.info(`  KCs: ${kcs.data!.map((kc) => kc.name).join("; ")}`);
  console.info(
    `  Final answers: ${[...answers].map(([n, v]) => `${n}: ${v.join(", ") || "none"}`).join("; ")}`,
  );
  console.info(`  Check report: ${JSON.stringify(build.data!.check_report)}`);
  return [
    result(
      "the map is built",
      build.data!.status === "built",
      build.data!.failure_reason ?? undefined,
    ),
    result("the map has KCs", kcs.data!.length > 0, `${kcs.data!.length} KCs`),
    result(
      "every KC is in English",
      notEnglish.length === 0,
      notEnglish.map((kc) => kc.name).join("; ") || undefined,
    ),
    result(
      "every KC cites a chunk of its unit",
      strays.length === 0,
      strays.join("; ") || undefined,
    ),
    result(
      "a top-level Topic covers Vector Spaces with children in section order",
      inOrder,
      vectorSpaces
        ? `${vectorSpaces.name}: ${sections.map((s) => s.name).join("; ") || "no children"}`
        : `top-level: ${childrenOf(null)
            .map((t) => t.name)
            .join("; ")}`,
    ),
    result(
      "Exercise 7's final answer is the printed 8, Exercise 10's the printed dim U = 2",
      String(answers.get(7)) === "8" && String(answers.get(10)) === "2",
      [...answers].map(([n, v]) => `${n}: ${v.join(", ")}`).join("; "),
    ),
  ];
}
