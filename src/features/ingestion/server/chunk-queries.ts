import "server-only";
import { z } from "zod";
import {
  CHUNK_LABELS,
  type ExerciseSolution,
  type MaterialChunks,
  type ParseStatus,
} from "@/features/ingestion/types";
import { getUser } from "@/lib/auth/user";
import { allRows } from "@/lib/supabase/all-rows";
import { createClient } from "@/lib/supabase/server";
import type { Supabase } from "@/lib/supabase/types";

const figureSchema = z.object({ description: z.string() }).nullable();

/**
 * The signed-in Student's Material with its chunks in reading order, or null
 * when the id is malformed, unknown, another Student's, or signed out. Row
 * Level Security scopes both reads.
 */
export async function getMaterialChunks(
  materialId: string,
): Promise<MaterialChunks | null> {
  if (!z.uuid().safeParse(materialId).success) return null;
  if (!(await getUser())) return null;
  const supabase = await createClient();

  const material = await supabase
    .from("materials")
    .select(
      "id, course_id, name, parse_status, is_exam, exam_year, exam_total_points",
    )
    .eq("id", materialId)
    .maybeSingle();
  if (material.error) {
    throw new Error(`Loading the Material failed: ${material.error.message}`);
  }
  if (!material.data) return null;

  const chunks = await allRows("Loading the chunks", (from, to) =>
    supabase
      .from("chunks")
      .select(
        "id, position, page_from, page_to, label, markdown, figure, exercise_number, points",
      )
      .eq("material_id", materialId)
      .order("position")
      .range(from, to),
  );

  const figures = chunks.map((chunk) =>
    figureSchema.parse(chunk.figure ?? null),
  );
  const solutions = await exerciseSolutions(
    supabase,
    chunks.filter((chunk) => chunk.label === "exercise").map((c) => c.id),
  );

  const row = material.data;
  return {
    materialId: row.id,
    courseId: row.course_id,
    name: row.name,
    parseStatus: row.parse_status as ParseStatus,
    exam: row.is_exam
      ? {
          year: row.exam_year,
          totalPoints:
            row.exam_total_points === null
              ? null
              : Number(row.exam_total_points),
        }
      : null,
    chunks: chunks.map((chunk, index) => ({
      id: chunk.id,
      position: chunk.position,
      pageFrom: chunk.page_from,
      pageTo: chunk.page_to,
      label: z.enum(CHUNK_LABELS).parse(chunk.label),
      markdown: chunk.markdown,
      figure: figures[index] ?? null,
      exerciseNumber: chunk.exercise_number,
      points: chunk.points === null ? null : Number(chunk.points),
      solution: solutions.get(chunk.id) ?? null,
    })),
  };
}

function failed(action: string, error: { message: string }): never {
  throw new Error(`${action} failed: ${error.message}`);
}

/** Ids per `in` filter, which keeps the query string short. */
const ID_SLICE = 100;

/**
 * The rows `read` gives for `ids`, read in slices of `ID_SLICE` distinct
 * ids, since ids go in the query string. No ids make no request.
 */
async function inSlices<Row>(
  action: string,
  ids: string[],
  read: (
    slice: string[],
  ) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const unique = [...new Set(ids)];
  const rows: Row[] = [];
  for (let start = 0; start < unique.length; start += ID_SLICE) {
    const { data, error } = await read(unique.slice(start, start + ID_SLICE));
    if (error) failed(action, error);
    rows.push(...(data ?? []));
  }
  return rows;
}

/**
 * The solutions of these exercise chunks, by exercise chunk id, with the
 * Material each solution is in. Exercises without a pair, such as an
 * exercise's shared statement, are left out.
 */
async function exerciseSolutions(
  supabase: Supabase,
  exerciseIds: string[],
): Promise<Map<string, ExerciseSolution>> {
  const result = new Map<string, ExerciseSolution>();
  if (exerciseIds.length === 0) return result;
  const pairs = await inSlices(
    "Loading the exercise solutions",
    exerciseIds,
    (ids) =>
      supabase
        .from("exercise_solutions")
        .select("exercise_chunk_id, solution_chunk_id, status")
        .in("exercise_chunk_id", ids),
  );
  const solutionChunks = await inSlices(
    "Loading the solution chunks",
    pairs.flatMap((pair) => pair.solution_chunk_id ?? []),
    (ids) =>
      supabase
        .from("chunks")
        .select("id, material_id, exercise_number")
        .in("id", ids),
  );
  const materials = await inSlices(
    "Loading the solutions' Materials",
    solutionChunks.map((c) => c.material_id),
    (ids) => supabase.from("materials").select("id, name").in("id", ids),
  );

  for (const pair of pairs) {
    const solution = solutionChunks.find(
      (chunk) => chunk.id === pair.solution_chunk_id,
    );
    const material = materials.find((m) => m.id === solution?.material_id);
    if (pair.status === "paired" && solution && material) {
      result.set(pair.exercise_chunk_id, {
        status: "paired",
        chunkId: solution.id,
        materialId: material.id,
        materialName: material.name,
        exerciseNumber: solution.exercise_number,
      });
    } else if (pair.status === "no_solution") {
      result.set(pair.exercise_chunk_id, { status: "no_solution" });
    }
  }
  return result;
}
