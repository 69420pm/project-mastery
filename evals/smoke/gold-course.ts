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

/** An Exercise's answer key, its value a mathjs expression. */
export type FinalAnswer = { label: string; value: string; anyOrder: boolean };

/** What a smoke check reads of the seeded Course, in course order. */
export type GoldCourse = {
  courseId: string;
  kcs: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  prerequisites: Array<{ from: string; to: string }>;
  /** The Topics with KCs of their own, in tree order. */
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
  const [kcs, links, topics, exercises, brief, chapters] = await Promise.all([
    supabase
      .from("kcs")
      .select("id, name, description")
      .eq("course_id", courseId)
      .is("retired_at", null)
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
        "id, final_answers, exercise_kcs(kc_id), chunks!exercises_question_chunk_id_fkey(markdown, page_from, chapter_id, materials(name))",
      )
      .eq("course_id", courseId)
      .order("position"),
    supabase
      .from("briefs")
      .select("reserved_exam_chapter_id")
      .eq("course_id", courseId)
      .maybeSingle(),
    supabase.from("chapters").select("id, parent_id").eq("course_id", courseId),
  ]);
  // The reserved exam's Chapter and every Chapter below it.
  const reservedId = must(brief)?.reserved_exam_chapter_id ?? null;
  const parentOf = new Map(must(chapters).map((c) => [c.id, c.parent_id]));
  const inReserved = (id: string | null): boolean =>
    id !== null && (id === reservedId || inReserved(parentOf.get(id) ?? null));
  return {
    courseId,
    kcs: must(kcs),
    prerequisites: must(links).map((link) => ({
      from: link.from_kc,
      to: link.to_kc,
    })),
    topics: must(topics).flatMap((topic) =>
      topic.central_question === null || topic.topic_kcs.length === 0
        ? []
        : [
            {
              id: topic.id,
              name: topic.name,
              centralQuestion: topic.central_question,
              kcs: topic.topic_kcs
                .toSorted((a, b) => a.position - b.position)
                .map((row) => row.kc_id),
            },
          ],
    ),
    exercises: must(exercises).map((exercise) => {
      const chunk = exercise.chunks;
      return {
        id: exercise.id,
        kcs: exercise.exercise_kcs.map((row) => row.kc_id),
        finalAnswers: exercise.final_answers as FinalAnswer[] | null,
        markdown: chunk.markdown,
        label: `${chunk.materials.name} p. ${chunk.page_from}`,
        reserved: reservedId !== null && inReserved(chunk.chapter_id),
      };
    }),
  };
}

/** The final answers written out, such as "x = 3, A = [[1, 2], [0, 1]]". */
export function answerText(answers: FinalAnswer[]) {
  return answers.map(({ label, value }) => `${label} = ${value}`).join(", ");
}

/**
 * The first askable Exercise with an answer key among those testing any of
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
