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

type Supabase = Parameters<SmokeCheck["run"]>[0]["supabase"];

/**
 * Builds the Knowledge map of the jet-engines chapter from its chunk fixture
 * with the real `buildKnowledgeMap` workflow, run in this process, and
 * prints the map's shape to compare with `gold.json` by hand.
 */
export const mapSmoke: SmokeCheck = {
  name: "map",
  usage: `pnpm smoke map (builds the map of ${CHUNKS_FILE}; prints KCs per big idea, prior KCs and the check report)`,
  maxCalls: 12,
  async run({ supabase, studentId }) {
    const fixture = fixtureSchema.parse(
      JSON.parse(await readFile(CHUNKS_FILE, "utf8")),
    );
    const { data: course, error: courseError } = await supabase
      .from("courses")
      .insert({ owner: studentId, name: "Smoke check" })
      .select("id")
      .single();
    if (courseError) throw new Error(courseError.message);
    const courseId = course.id;

    const materialId = randomUUID();
    const { error: materialError } = await supabase.from("materials").insert({
      id: materialId,
      owner: studentId,
      course_id: courseId,
      name: "jet-engines.pdf",
      media_type: "application/pdf",
      size_bytes: 1,
      storage_path: `${studentId}/${courseId}/${materialId}`,
      parse_status: "parsed",
    });
    if (materialError) throw new Error(materialError.message);

    const { error: chunksError } = await supabase.from("chunks").insert(
      fixture.map(({ figure_description, ...chunk }) => ({
        ...chunk,
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
    );
    if (chunksError) throw new Error(chunksError.message);

    // queue_knowledge_map_build needs a signed-in Student, so the smoke
    // check sets the state it leaves behind.
    const { error: buildError } = await supabase
      .from("knowledge_map_builds")
      .insert({ course_id: courseId, owner: studentId, status: "building" });
    if (buildError) throw new Error(buildError.message);

    console.info(`Building the map from ${fixture.length} chunks…`);
    await buildKnowledgeMap(courseId);
    return checkBuiltMap(supabase, courseId);
  },
};

async function checkBuiltMap(
  supabase: Supabase,
  courseId: string,
): Promise<SmokeResult[]> {
  const [build, bigIdeas, kcs, sources, prerequisites] = await Promise.all([
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
      .select("id, name, type, big_idea_id")
      .eq("course_id", courseId)
      .order("position"),
    supabase.from("kc_sources").select("kc_id").eq("course_id", courseId),
    supabase
      .from("prerequisite_links")
      .select("from_kc, to_kc")
      .eq("course_id", courseId),
  ]);
  for (const { error } of [build, bigIdeas, kcs, sources, prerequisites]) {
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
