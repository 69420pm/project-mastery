import "server-only";
import { z } from "zod";
import type { ProblemFlag } from "@/features/study/types";
import { allRows } from "@/lib/supabase/all-rows";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * A Course's generated Problems as the tutor reads them (#183): only the
 * generate workflow writes them, and the Student may flag a ready one once.
 */

/** A ready generated Problem as `findProblems` ranks and shows it. */
export type ReadyProblem = {
  id: string;
  source: "variant" | "new";
  /** The KCs it tests. */
  kcs: string[];
  difficulty: number;
  statement: string;
  solution: string;
  /** Whether its numbers come from a program. */
  hasProgram: boolean;
  /** The Exercise a variant varies, while it exists. */
  originalExerciseId: string | null;
};

const isUuid = (value: string) => z.uuid().safeParse(value).success;

/** The Course's ready Problems that are not flagged, oldest first. */
export async function loadReadyProblems(
  supabase: Supabase,
  courseId: string,
): Promise<ReadyProblem[]> {
  const rows = await allRows("Loading the generated Problems", (from, to) =>
    supabase
      .from("problems")
      .select(
        "id, source, difficulty, statement, solution, program, original_exercise_id, problem_kcs(kc_id)",
      )
      .eq("course_id", courseId)
      .eq("status", "ready")
      .is("flag", null)
      .order("created_at")
      .order("id")
      .range(from, to),
  );
  return rows.map((row) => ({
    id: row.id,
    source: row.source as ReadyProblem["source"],
    kcs: row.problem_kcs.map(({ kc_id }) => kc_id),
    difficulty: row.difficulty,
    // A ready Problem has both (a check of the table).
    statement: row.statement ?? "",
    solution: row.solution ?? "",
    hasProgram: row.program !== null,
    originalExerciseId: row.original_exercise_id,
  }));
}

/**
 * Whether the id is a ready Problem of the Course, which a question may
 * pose; flagged or not, as the question insert policy allows.
 */
export async function isReadyProblem(
  supabase: Supabase,
  courseId: string,
  problemId: string,
): Promise<boolean> {
  if (!isUuid(problemId)) return false;
  const { data, error } = await supabase
    .from("problems")
    .select("id")
    .eq("id", problemId)
    .eq("course_id", courseId)
    .eq("status", "ready")
    .maybeSingle();
  if (error) failed("Loading the Problem", error);
  return data !== null;
}

/**
 * Flags a ready Problem of the Student's, once. False when it is unknown,
 * not ready or already flagged, changing nothing.
 */
export async function flagReadyProblem(
  supabase: Supabase,
  problemId: string,
  flag: ProblemFlag,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("problems")
    .update({ flag })
    .eq("id", problemId)
    .eq("status", "ready")
    .is("flag", null)
    .select("id");
  if (error) failed("Flagging the Problem", error);
  return data.length > 0;
}

/**
 * The flags of the generated Problems posed in a Chat's Study session, by
 * Problem id; a Problem without a flag is missing.
 */
export async function loadProblemFlags(
  supabase: Supabase,
  chatId: string,
): Promise<Record<string, ProblemFlag>> {
  const { data, error } = await supabase
    .from("questions")
    .select("problem_id, study_sessions!inner(chat_id)")
    .eq("study_sessions.chat_id", chatId)
    .not("problem_id", "is", null);
  if (error) failed("Loading the posed Problems", error);
  const ids = [...new Set(data.flatMap(({ problem_id }) => problem_id ?? []))];
  if (ids.length === 0) return {};
  const { data: flagged, error: flagError } = await supabase
    .from("problems")
    .select("id, flag")
    .in("id", ids)
    .not("flag", "is", null);
  if (flagError) failed("Loading the Problems' flags", flagError);
  return Object.fromEntries(
    flagged.map(({ id, flag }) => [id, flag as ProblemFlag]),
  );
}
