import "server-only";
import { z } from "zod";
import {
  CHUNK_LABELS,
  type ExerciseSolution,
  type MaterialChunks,
  type ParseStatus,
} from "@/features/ingestion/types";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import type { Supabase } from "@/lib/supabase/types";

const figureSchema = z
  .object({ description: z.string(), cropPath: z.string().nullable() })
  .nullable();

/** The Storage bucket of Materials, their page images and figure crops. */
const BUCKET = "course-files";

/** How long the link to a figure's picture works: one viewing session. */
const FIGURE_URL_SECONDS = 60 * 60;

/** A link to a figure's picture, or null when it cannot be signed. */
async function signFigureUrl(supabase: Supabase, path: string) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, FIGURE_URL_SECONDS);
  if (error) {
    console.error("Signing a figure's link failed", error);
    return null;
  }
  return data.signedUrl;
}

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

  const chunks = await supabase
    .from("chunks")
    .select(
      "id, position, page_from, page_to, label, markdown, figure, exercise_number, points",
    )
    .eq("material_id", materialId)
    .order("position");
  if (chunks.error) {
    throw new Error(`Loading the chunks failed: ${chunks.error.message}`);
  }

  const figures = await Promise.all(
    chunks.data.map(async (chunk) => {
      const figure = figureSchema.parse(chunk.figure ?? null);
      if (!figure) return null;
      return {
        ...figure,
        imageUrl: figure.cropPath
          ? await signFigureUrl(supabase, figure.cropPath)
          : null,
      };
    }),
  );

  const solutions = await exerciseSolutions(
    supabase,
    chunks.data.filter((chunk) => chunk.label === "exercise").map((c) => c.id),
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
    chunks: chunks.data.map((chunk, index) => ({
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
  const pairs = await supabase
    .from("exercise_solutions")
    .select("exercise_chunk_id, solution_chunk_id, status")
    .in("exercise_chunk_id", exerciseIds);
  if (pairs.error) failed("Loading the exercise solutions", pairs.error);

  const solutionIds = pairs.data.flatMap(
    (pair) => pair.solution_chunk_id ?? [],
  );
  const solutionChunks =
    solutionIds.length === 0
      ? []
      : await supabase
          .from("chunks")
          .select("id, material_id, exercise_number")
          .in("id", solutionIds)
          .then(({ data, error }) => {
            if (error) failed("Loading the solution chunks", error);
            return data;
          });
  const materialIds = [...new Set(solutionChunks.map((c) => c.material_id))];
  const materials =
    materialIds.length === 0
      ? []
      : await supabase
          .from("materials")
          .select("id, name")
          .in("id", materialIds)
          .then(({ data, error }) => {
            if (error) failed("Loading the solutions' Materials", error);
            return data;
          });

  for (const pair of pairs.data) {
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
