import { access } from "node:fs/promises";
import path from "node:path";
import type { AdminSupabase } from "@/lib/supabase/types";
import { GOLD_DIR, readSnapshot, seedSnapshot } from "./gold-seed";

/**
 * The gold course the smoke checks that need a built map start from: the
 * `linear-algebra-I` snapshot, seeded for the check's Student through the
 * `pnpm gold seed` code, without model calls.
 */
export const GOLD_SLUG = "linear-algebra-I";

export type FinalAnswer = { label: string; value: number; unit: string | null };

/** What a smoke check reads of the seeded Course, in course order. */
export type GoldCourse = {
  courseId: string;
  bigIdeas: Array<{ id: string; name: string }>;
  kcs: Array<{
    id: string;
    name: string;
    description: string;
    bigIdeaId: string;
  }>;
  prerequisites: Array<{ from: string; to: string }>;
  topics: Array<{
    id: string;
    name: string;
    centralQuestion: string;
    kcs: string[];
  }>;
  exercises: Array<{
    id: string;
    kcs: string[];
    finalAnswers: FinalAnswer[] | null;
    markdown: string;
    /** As `findProblems` names it: "<Material> p. <page>". */
    label: string;
    /** In the Material the Brief reserves as the last exam. */
    reserved: boolean;
  }>;
};

/** Rows of `table` inserted as given, with the admin client. */
export async function insertRows(
  supabase: AdminSupabase,
  table: string,
  rows: object[],
) {
  const { error } = await supabase.from(table as "kcs").insert(rows as never);
  if (error) throw new Error(`${table}: ${error.message}`);
}

function must<T>(response: {
  data: T | null;
  error: { message: string } | null;
}) {
  if (response.error) throw new Error(response.error.message);
  return response.data as T;
}

/**
 * Seeds the gold course for `studentId` with the exam `examInDays` away and
 * reads it back. Stops with "Run the gold run first (#222)" while the
 * snapshot does not exist.
 */
export async function seedGoldCourse(
  supabase: AdminSupabase,
  studentId: string,
  examInDays = 42,
): Promise<GoldCourse> {
  try {
    await access(path.join(GOLD_DIR, GOLD_SLUG, "snapshot.json.gz"));
  } catch {
    throw new Error(
      `Run the gold run first (#222): ${GOLD_DIR}/${GOLD_SLUG}/snapshot.json.gz does not exist.`,
    );
  }
  const snapshot = await readSnapshot(GOLD_SLUG);
  const courseId = await seedSnapshot(
    supabase,
    GOLD_SLUG,
    snapshot,
    studentId,
    examInDays,
  );
  return loadGoldCourse(supabase, courseId);
}

async function loadGoldCourse(
  supabase: AdminSupabase,
  courseId: string,
): Promise<GoldCourse> {
  const [bigIdeas, kcs, links, topics, exercises, brief] = await Promise.all([
    supabase
      .from("big_ideas")
      .select("id, name")
      .eq("course_id", courseId)
      .order("position"),
    supabase
      .from("kcs")
      .select("id, name, description, big_idea_id")
      .eq("course_id", courseId)
      .order("position"),
    supabase
      .from("prerequisite_links")
      .select("from_kc, to_kc")
      .eq("course_id", courseId),
    supabase
      .from("topics")
      .select("id, name, central_question, topic_kcs(kc_id, position)")
      .eq("course_id", courseId)
      .order("position"),
    supabase
      .from("exercises")
      .select(
        "id, final_answers, exercise_kcs(kc_id), chunks!exercises_question_chunk_id_fkey(markdown, page_from, material_id, materials(name))",
      )
      .eq("course_id", courseId)
      .order("position"),
    supabase
      .from("briefs")
      .select("reserved_exam_material_id")
      .eq("course_id", courseId)
      .maybeSingle(),
  ]);
  const reserved = must(brief)?.reserved_exam_material_id ?? null;
  return {
    courseId,
    bigIdeas: must(bigIdeas),
    kcs: must(kcs).map((kc) => ({
      id: kc.id,
      name: kc.name,
      description: kc.description,
      bigIdeaId: kc.big_idea_id,
    })),
    prerequisites: must(links).map((link) => ({
      from: link.from_kc,
      to: link.to_kc,
    })),
    topics: must(topics).map((topic) => ({
      id: topic.id,
      name: topic.name,
      centralQuestion: topic.central_question,
      kcs: topic.topic_kcs
        .toSorted((a, b) => a.position - b.position)
        .map((row) => row.kc_id),
    })),
    exercises: must(exercises).map((exercise) => {
      const chunk = exercise.chunks;
      return {
        id: exercise.id,
        kcs: exercise.exercise_kcs.map((row) => row.kc_id),
        finalAnswers: exercise.final_answers as FinalAnswer[] | null,
        markdown: chunk.markdown,
        label: `${chunk.materials.name} p. ${chunk.page_from}`,
        reserved: chunk.material_id === reserved,
      };
    }),
  };
}

/** The final answers written out, such as "x = 3, det = -2 m". */
export function answerText(answers: FinalAnswer[]) {
  return answers
    .map(
      ({ label, value, unit }) =>
        `${label} = ${value}${unit ? ` ${unit}` : ""}`,
    )
    .join(", ");
}

/**
 * The first askable Exercise with a numeric key among those testing any of
 * `kcIds`, or among all when none does.
 */
export function numericExercise(gold: GoldCourse, kcIds: Iterable<string>) {
  const wanted = new Set(kcIds);
  const numeric = gold.exercises.filter(
    (e) => !e.reserved && (e.finalAnswers?.length ?? 0) > 0,
  );
  const exercise =
    numeric.find((e) => e.kcs.some((kc) => wanted.has(kc))) ?? numeric[0];
  if (!exercise) {
    throw new Error("The gold course has no Exercise with a final answer.");
  }
  return exercise as typeof exercise & { finalAnswers: FinalAnswer[] };
}
