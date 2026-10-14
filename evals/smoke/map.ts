import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { buildKnowledgeMap } from "@/features/knowledge-map/server";
import { result, type SmokeCheck, type SmokeResult } from "./smoke-check";

const CHUNKS_FILE = "evals/gold/jet-engines/chunks.json";

const fixtureSchema = z.array(
  z.object({
    position: z.number(),
    page_from: z.number(),
    page_to: z.number(),
    label: z.string(),
    markdown: z.string(),
    exercise_number: z.string().nullable(),
    points: z.number().nullable(),
    figure_description: z.string().nullable(),
  }),
);

/** Each exercise chunk's paired solution chunk, by fixture position. */
const pairsSchema = z.array(
  z.object({
    position: z.number(),
    label: z.string(),
    solution_position: z.number().optional(),
  }),
);

/** The fixture position of the question of Exercise 7.1, whose solution is wrong. */
const EXERCISE_7_1_POSITION = 24;

type Supabase = Parameters<SmokeCheck["run"]>[0]["supabase"];

type Fixture = z.infer<typeof fixtureSchema>;

/**
 * Builds the Knowledge map of the jet-engines chapter from its chunk fixture,
 * split by position into two Materials, with the real `buildKnowledgeMap`
 * workflow run in this process: a build from the first half, then an update
 * after adding the second half with the exercise-solution pairs. Prints the
 * merges the update makes (the workflow's "Merged KCs" lines), the map's
 * shape and Exercises to compare with `gold.json` by hand.
 */
export const mapSmoke: SmokeCheck = {
  name: "map",
  usage: `pnpm smoke map (builds the map of the first half of ${CHUNKS_FILE}, updates it with the second; prints merges, KCs per big idea, prior KCs, Exercises, Findings and the check report)`,
  // Per run: a skeleton, an assignment per 10 chunks, a fill per big idea,
  // links, an embedding and a merge call; the update adds 4 exercise
  // subtasks and the links call for KCs they add.
  maxCalls: 30,
  async run({ supabase, studentId }) {
    const json: unknown = JSON.parse(await readFile(CHUNKS_FILE, "utf8"));
    const fixture = fixtureSchema.parse(json);
    const { data: course, error: courseError } = await supabase
      .from("courses")
      .insert({ owner: studentId, name: "Smoke check" })
      .select("id")
      .single();
    if (courseError) throw new Error(courseError.message);
    const courseId = course.id;
    const half = Math.ceil(fixture.length / 2);
    const material = (name: string, chunks: Fixture) =>
      insertMaterial(supabase, { studentId, courseId, name, chunks });

    const idAt = await material("jet-engines-1.pdf", fixture.slice(0, half));
    // queue_knowledge_map_build needs a signed-in Student, so the smoke
    // check sets the state it leaves behind.
    const { error: buildError } = await supabase
      .from("knowledge_map_builds")
      .insert({ course_id: courseId, owner: studentId, status: "building" });
    if (buildError) throw new Error(buildError.message);
    console.info(`Building the map from ${half} chunks…`);
    await buildKnowledgeMap(courseId);
    const first = await builtKcs(supabase, courseId);

    for (const [position, id] of await material(
      "jet-engines-2.pdf",
      fixture.slice(half),
    )) {
      idAt.set(position, id);
    }
    // The pairs the parse step's pairing would have stored.
    const { error: pairsError } = await supabase
      .from("exercise_solutions")
      .insert(
        pairsSchema
          .parse(json)
          .filter((chunk) => chunk.label === "exercise")
          .map((chunk) => {
            const solution =
              chunk.solution_position === undefined
                ? null
                : (idAt.get(chunk.solution_position) ?? null);
            return {
              owner: studentId,
              course_id: courseId,
              exercise_chunk_id: idAt.get(chunk.position)!,
              solution_chunk_id: solution,
              status: solution ? "paired" : "no_solution",
            };
          }),
      );
    if (pairsError) throw new Error(pairsError.message);

    const { error: updateError } = await supabase
      .from("knowledge_map_builds")
      .update({ status: "building", failure_reason: null })
      .eq("course_id", courseId);
    if (updateError) throw new Error(updateError.message);
    console.info(`Updating the map with ${fixture.length - half} chunks…`);
    await buildKnowledgeMap(courseId);

    const after = await builtKcs(supabase, courseId);
    const { count, error: processedError } = await supabase
      .from("knowledge_map_chunks")
      .select("chunk_id", { count: "exact", head: true })
      .eq("course_id", courseId);
    if (processedError) throw new Error(processedError.message);
    const kept = new Set(after.kcs.map((kc) => kc.id));
    const lost = first.kcs.filter(
      (kc) => first.sourced.has(kc.id) && !kept.has(kc.id),
    );
    const results = await checkBuiltMap(supabase, courseId, idAt);
    return [
      result(
        "the first build is built",
        first.status === "built",
        first.status,
      ),
      ...results,
      result(
        "every sourced KC of the first build survives the update",
        lost.length === 0,
        lost.map((kc) => kc.name).join("; "),
      ),
      result(
        "no chunk is processed twice",
        count === fixture.length,
        `${count} processed of ${fixture.length}`,
      ),
      result(
        "the check report has a duplicates entry",
        Array.isArray(after.checkReport?.duplicates),
        JSON.stringify(after.checkReport?.duplicates),
      ),
    ];
  },
};

/**
 * A parsed Material of these fixture chunks, positions counted from its
 * first; returns the chunk ids by fixture position.
 */
async function insertMaterial(
  supabase: Supabase,
  {
    studentId,
    courseId,
    name,
    chunks,
  }: { studentId: string; courseId: string; name: string; chunks: Fixture },
): Promise<Map<number, string>> {
  const materialId = randomUUID();
  const { error: materialError } = await supabase.from("materials").insert({
    id: materialId,
    owner: studentId,
    course_id: courseId,
    name,
    media_type: "application/pdf",
    size_bytes: 1,
    storage_path: `${studentId}/${courseId}/${materialId}`,
    parse_status: "parsed",
  });
  if (materialError) throw new Error(materialError.message);
  const offset = chunks[0]?.position ?? 0;
  const { data, error } = await supabase
    .from("chunks")
    .insert(
      chunks.map(({ figure_description, ...chunk }) => ({
        ...chunk,
        position: chunk.position - offset,
        owner: studentId,
        course_id: courseId,
        material_id: materialId,
        figure: figure_description
          ? {
              description: figure_description,
              page: chunk.page_from,
              box: null,
            }
          : null,
      })),
    )
    .select("id, position");
  if (error) throw new Error(error.message);
  return new Map(data.map((row) => [row.position + offset, row.id]));
}

/** The build's status and check report, its KCs and which have a source. */
async function builtKcs(supabase: Supabase, courseId: string) {
  const [build, kcs, sources] = await Promise.all([
    supabase
      .from("knowledge_map_builds")
      .select("status, check_report")
      .eq("course_id", courseId)
      .single(),
    supabase.from("kcs").select("id, name").eq("course_id", courseId),
    supabase.from("kc_sources").select("kc_id").eq("course_id", courseId),
  ]);
  for (const { error } of [build, kcs, sources]) {
    if (error) throw new Error(error.message);
  }
  return {
    status: build.data!.status,
    checkReport: build.data!.check_report as { duplicates?: unknown } | null,
    kcs: kcs.data!,
    sourced: new Set(sources.data!.map((source) => source.kc_id)),
  };
}

async function checkBuiltMap(
  supabase: Supabase,
  courseId: string,
  idAt: Map<number, string>,
): Promise<SmokeResult[]> {
  // Fixture positions, which gold.json's sources use, by chunk id.
  const positionOf = new Map([...idAt].map(([position, id]) => [id, position]));
  const [
    build,
    bigIdeas,
    kcs,
    sources,
    prerequisites,
    chunks,
    exercises,
    exerciseKcs,
    findings,
    findingSources,
  ] = await Promise.all([
    supabase
      .from("knowledge_map_builds")
      .select("status, failure_reason, check_report")
      .eq("course_id", courseId)
      .single(),
    supabase
      .from("big_ideas")
      .select("id, name")
      .eq("course_id", courseId)
      .order("position"),
    supabase
      .from("kcs")
      .select("id, name, type, big_idea_id, origin")
      .eq("course_id", courseId)
      .order("position"),
    supabase.from("kc_sources").select("kc_id").eq("course_id", courseId),
    supabase
      .from("prerequisite_links")
      .select("from_kc, to_kc")
      .eq("course_id", courseId),
    supabase
      .from("chunks")
      .select("id, position, label")
      .eq("course_id", courseId),
    supabase
      .from("exercises")
      .select(
        "id, name, question_chunk_id, task_type, solution_status, solution, difficulty",
      )
      .eq("course_id", courseId)
      .order("position"),
    supabase
      .from("exercise_kcs")
      .select("exercise_id, kc_id")
      .eq("course_id", courseId),
    supabase
      .from("findings")
      .select("id, text")
      .eq("course_id", courseId)
      .order("position"),
    supabase
      .from("finding_sources")
      .select("finding_id, chunk_id")
      .eq("course_id", courseId),
  ]);
  for (const { error } of [
    build,
    bigIdeas,
    kcs,
    sources,
    prerequisites,
    chunks,
    exercises,
    exerciseKcs,
    findings,
    findingSources,
  ]) {
    if (error) throw new Error(error.message);
  }
  const { status, failure_reason, check_report } = build.data!;
  const allKcs = kcs.data!;
  const sourced = new Set(sources.data!.map((s) => s.kc_id));
  const unsourced = allKcs.filter(
    (kc) => kc.type !== "prior" && !sourced.has(kc.id),
  );

  console.info("\nKCs per big idea:");
  for (const bigIdea of bigIdeas.data!) {
    const count = allKcs.filter((kc) => kc.big_idea_id === bigIdea.id).length;
    console.info(`  ${count}  ${bigIdea.name}`);
  }
  const prior = allKcs.filter((kc) => kc.type === "prior");
  console.info(
    `Prior KCs (${prior.length}): ${prior.map((kc) => kc.name).join("; ") || "none"}`,
  );
  console.info(
    `${allKcs.length} KCs, ${prerequisites.data!.length} prerequisites. Check report:\n${JSON.stringify(check_report, null, 2)}`,
  );
  // Fixture positions, which gold.json's sources use, instead of row ids.
  const uncovered = (
    (check_report as { uncoveredChunkIds?: string[] } | null)
      ?.uncoveredChunkIds ?? []
  ).map((id) => {
    const chunk = chunks.data!.find((row) => row.id === id);
    return chunk ? `${positionOf.get(id)} (${chunk.label})` : id;
  });
  console.info(`Uncovered chunk positions: ${uncovered.join(", ") || "none"}`);

  const kcName = new Map(allKcs.map((kc) => [kc.id, kc.name]));
  const fromExercises = allKcs.filter((kc) => kc.origin === "exercise");
  console.info(
    `KCs from exercises (${fromExercises.length}): ${fromExercises.map((kc) => kc.name).join("; ") || "none"}`,
  );
  const allExercises = exercises.data!;
  const kcsOf = (exerciseId: string) =>
    exerciseKcs
      .data!.filter((row) => row.exercise_id === exerciseId)
      .map((row) => kcName.get(row.kc_id) ?? row.kc_id);
  console.info("\nExercises:");
  for (const exercise of allExercises) {
    console.info(
      `  ${exercise.name} [${exercise.task_type}] ${exercise.solution_status}, difficulty ${exercise.difficulty}: ${kcsOf(exercise.id).join("; ")}`,
    );
  }
  console.info(
    `Findings: ${findings.data!.map((finding) => finding.text).join("\n  ") || "none"}`,
  );

  // Reported, not checked: the model may judge either way.
  const exercise71 = allExercises.find(
    (exercise) =>
      positionOf.get(exercise.question_chunk_id) === EXERCISE_7_1_POSITION,
  );
  const findingOn71 = findingSources.data!.some(
    (source) => source.chunk_id === exercise71?.question_chunk_id,
  );
  console.info(
    `Ex 7.1 is ${exercise71?.solution_status ?? "missing"}, ${findingOn71 ? "with" : "without"} a finding.`,
  );
  const propulsive = allKcs.filter((kc) => /propulsive power/i.test(kc.name));
  console.info(
    `Propulsive-power KC: ${propulsive.map((kc) => `${kc.name} (${kc.origin})`).join("; ") || "none"}`,
  );

  const unmapped = allExercises.filter(
    (exercise) => kcsOf(exercise.id).length === 0,
  );
  const unsolved = allExercises.filter(
    (exercise) =>
      exercise.solution_status === "generated" && !exercise.solution,
  );
  const exerciseKcsUnsourced = fromExercises.filter(
    (kc) => !sourced.has(kc.id),
  );
  const exerciseChunks = chunks.data!.filter(
    (chunk) => chunk.label === "exercise",
  );

  return [
    result(
      "the build is built",
      status === "built",
      status === "built" ? undefined : `${status}: ${failure_reason}`,
    ),
    result(
      "every non-prior KC has a source",
      unsourced.length === 0,
      unsourced.length ? unsourced.map((kc) => kc.name).join("; ") : undefined,
    ),
    result("the prerequisite graph is acyclic", !hasCycle(prerequisites.data!)),
    result("the check report is stored", check_report !== null),
    result(
      "every exercise chunk is an Exercise",
      allExercises.length === exerciseChunks.length,
      `${allExercises.length} of ${exerciseChunks.length}`,
    ),
    result(
      "every Exercise has a KC and a status",
      unmapped.length === 0 &&
        allExercises.every((exercise) => exercise.solution_status),
      unmapped.map((exercise) => exercise.name).join("; "),
    ),
    result(
      "every generated Exercise has a solution",
      unsolved.length === 0,
      unsolved.map((exercise) => exercise.name).join("; "),
    ),
    result(
      "every KC from an exercise has a source",
      exerciseKcsUnsourced.length === 0,
      exerciseKcsUnsourced.map((kc) => kc.name).join("; "),
    ),
  ];
}

/** Whether the directed graph of `from_kc -> to_kc` edges has a cycle. */
function hasCycle(edges: { from_kc: string; to_kc: string }[]) {
  const next = Map.groupBy(edges, (edge) => edge.from_kc);
  const done = new Set<string>();
  const onPath = new Set<string>();
  const visit = (node: string): boolean => {
    if (onPath.has(node)) return true;
    if (done.has(node)) return false;
    onPath.add(node);
    const cyclic = (next.get(node) ?? []).some((edge) => visit(edge.to_kc));
    onPath.delete(node);
    done.add(node);
    return cyclic;
  };
  return [...next.keys()].some(visit);
}
