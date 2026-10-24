import { readFile } from "node:fs/promises";
import {
  checkAnnotations,
  checkStudyText,
  loadCourseTopics,
  type CourseTopic,
} from "@/features/knowledge-map/server";
import { insertGoldMap } from "./gold-map";
import { CHUNKS_FILE, fixtureSchema, insertMaterial } from "./map";
import { result, type SmokeCheck } from "./smoke-check";
import { build } from "./topics";

type Supabase = Parameters<typeof insertGoldMap>[0];

/**
 * Stores the jet-engines gold map with the real chunks of `chunks.json`, KC
 * sources from the gold positions and every chunk processed, and runs the
 * real `buildKnowledgeMap` workflow on it, which has no new chunks and makes
 * the `topic` calls, then a `reading` mode call per Reading section and a
 * writing call per section that is not `original`. Checks that every
 * Topic's sections are stored with a mode and that the annotations and study
 * texts pass their checks, then reruns the build: no `reading` call, the same
 * sections. Prints each section's mode, reason and text to read by hand.
 */
export const readingSmoke: SmokeCheck = {
  name: "reading",
  usage:
    "pnpm smoke reading (the jet-engines gold map with its real chunks, built twice; prints each Reading section's mode, reason and text)",
  async run({ supabase, studentId }) {
    const { data: course, error } = await supabase
      .from("courses")
      .insert({ owner: studentId, name: "Smoke check" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const courseId = course.id;
    const gold = await insertGoldMap(supabase, studentId, courseId);
    const fixture = fixtureSchema.parse(
      JSON.parse(await readFile(CHUNKS_FILE, "utf8")),
    );
    const idAt = await insertMaterial(supabase, {
      studentId,
      courseId,
      name: "jet-engines.pdf",
      chunks: fixture,
    });
    await insertRows(
      supabase.from("kc_sources").insert(
        gold.gold.kcs.flatMap((kc) =>
          kc.sources.map((position) => ({
            owner: studentId,
            course_id: courseId,
            kc_id: gold.id(kc.id),
            chunk_id: idAt.get(position) as string,
          })),
        ),
      ),
      "kc_sources",
    );
    await insertRows(
      supabase.from("knowledge_map_chunks").insert(
        [...idAt.values()].map((chunkId) => ({
          owner: studentId,
          course_id: courseId,
          chunk_id: chunkId,
        })),
      ),
      "knowledge_map_chunks",
    );

    const first = await build(supabase, courseId);
    const topics = await loadCourseTopics(courseId, supabase);
    const calls = await readingCalls(supabase, studentId);
    print(topics);

    const rerun = await build(supabase, courseId);
    const afterRerun = await loadCourseTopics(courseId, supabase);
    const rerunCalls = (await readingCalls(supabase, studentId)) - calls;

    const sections = topics.flatMap((topic) => topic.readingSections);
    const failing = sections.flatMap((section) => {
      try {
        if (section.mode === "annotated") {
          checkAnnotations(section.annotations ?? [], section);
        }
        if (section.mode === "study_text") {
          checkStudyText(section.studyText ?? "", section);
        }
        return [];
      } catch (checkError) {
        return [`p. ${section.pageFrom}: ${String(checkError)}`];
      }
    });
    const snapshot = (list: CourseTopic[]) =>
      JSON.stringify(
        list.flatMap((topic) =>
          topic.readingSections.map(({ id, mode }) => [id, mode]),
        ),
      );
    const modes = Object.entries(
      Object.groupBy(sections, (section) => section.mode),
    ).map(([mode, list]) => `${mode} ×${list?.length}`);
    return [
      result("the first build is built", first === "built", first),
      result(
        "every Topic has Reading sections, each with a mode and reason",
        topics.length > 0 &&
          topics.every((topic) => topic.readingSections.length > 0) &&
          sections.every((section) => section.reason.trim() !== ""),
        `${topics.length} Topics, ${sections.length} sections: ${modes.join(", ")}`,
      ),
      result(
        "no section stays unjudged or failed",
        sections.every(
          (section) => !/^(Not judged|The .* failed)/.test(section.reason),
        ),
        sections
          .filter((section) =>
            /^(Not judged|The .* failed)/.test(section.reason),
          )
          .map((section) => `p. ${section.pageFrom}: ${section.reason}`)
          .join("; "),
      ),
      result(
        "a reading call per section, plus one per non-original section",
        calls ===
          sections.length +
            sections.filter((section) => section.mode !== "original").length,
        `${calls} calls`,
      ),
      result(
        "annotations and study texts pass their checks",
        failing.length === 0,
        failing.join("; "),
      ),
      result("the rerun is built", rerun === "built", rerun),
      result(
        "the rerun makes no reading call",
        rerunCalls === 0,
        `${rerunCalls}`,
      ),
      result(
        "the rerun keeps every section and mode",
        snapshot(afterRerun) === snapshot(topics),
      ),
    ];
  },
};

/** The `reading` calls the Student's runs recorded so far. */
async function readingCalls(supabase: Supabase, studentId: string) {
  const { count, error } = await supabase
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("owner", studentId)
    .eq("task", "reading");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function insertRows(
  insert: PromiseLike<{ error: { message: string } | null }>,
  table: string,
) {
  const { error } = await insert;
  if (error) throw new Error(`${table}: ${error.message}`);
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Prints every section with its mode, reason and text for a human to judge. */
function print(topics: CourseTopic[]) {
  for (const topic of topics) {
    console.info(`\n## ${topic.name} (${topic.centralQuestion})`);
    for (const section of topic.readingSections) {
      const pages =
        section.pageFrom === section.pageTo
          ? `p. ${section.pageFrom}`
          : `pp. ${section.pageFrom}–${section.pageTo}`;
      console.info(
        `\n### ${pages}, ${section.chunkIds.length} chunks: ${section.mode}\nreason: ${section.reason}`,
      );
      for (const note of section.annotations ?? []) {
        console.info(`  [p. ${note.page}] ${note.note}`);
      }
      if (section.studyText) {
        console.info(
          `(${words(section.studyText)} words)\n${section.studyText}`,
        );
      }
    }
  }
}
