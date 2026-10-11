import "server-only";
import { z } from "zod";
import {
  CHUNK_LABELS,
  type MaterialChunks,
  type ParseStatus,
} from "@/features/ingestion/types";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

const figureSchema = z
  .object({ description: z.string(), cropPath: z.string().nullable() })
  .nullable();

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
    chunks: chunks.data.map((chunk) => ({
      id: chunk.id,
      position: chunk.position,
      pageFrom: chunk.page_from,
      pageTo: chunk.page_to,
      label: z.enum(CHUNK_LABELS).parse(chunk.label),
      markdown: chunk.markdown,
      figure: figureSchema.parse(chunk.figure ?? null),
      exerciseNumber: chunk.exercise_number,
      points: chunk.points === null ? null : Number(chunk.points),
    })),
  };
}
