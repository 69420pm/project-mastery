import "server-only";
import { z } from "zod";
import type { ReadingSection } from "@/features/knowledge-map/domain/topic-reading";
import { allRows } from "@/lib/supabase/all-rows";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

const annotationsSchema = z
  .array(z.object({ page: z.number(), note: z.string() }))
  .nullable();

const SECTION_COLUMNS =
  "id, topic_id, material_id, position, page_from, page_to, chunk_ids, mode, reason, annotations, study_text, materials(name)";

type SectionRow = {
  id: string;
  material_id: string;
  page_from: number;
  page_to: number;
  chunk_ids: string[];
  mode: string;
  reason: string;
  annotations: unknown;
  study_text: string | null;
  materials: { name: string } | null;
};

function toSection(row: SectionRow): ReadingSection {
  return {
    id: row.id,
    materialId: row.material_id,
    materialName: row.materials?.name ?? "",
    pageFrom: row.page_from,
    pageTo: row.page_to,
    chunkIds: row.chunk_ids,
    mode: z.enum(["original", "annotated", "study_text"]).parse(row.mode),
    reason: row.reason,
    annotations: annotationsSchema.parse(row.annotations),
    studyText: row.study_text,
  };
}

/**
 * The Course's stored Reading sections (#178) by Topic id, each Topic's in
 * order; a Topic has none before stage 2c stored them. Reads on the admin
 * client or a Student's session client, where Row Level Security leaves
 * another Student's Course empty.
 */
export async function loadStoredReadingSections(
  supabase: Supabase,
  courseId: string,
): Promise<Map<string, ReadingSection[]>> {
  const rows = await allRows("Loading the reading sections", (from, to) =>
    supabase
      .from("reading_sections")
      .select(SECTION_COLUMNS)
      .eq("course_id", courseId)
      .order("topic_id")
      .order("position")
      .range(from, to),
  );
  const byTopic = new Map<string, ReadingSection[]>();
  for (const row of rows) {
    const sections = byTopic.get(row.topic_id) ?? [];
    sections.push(toSection(row));
    byTopic.set(row.topic_id, sections);
  }
  return byTopic;
}

/**
 * One stored Reading section of the Course, or null when the Course has no
 * section with this id. On a Student's session client, Row Level Security
 * leaves out another Student's sections.
 */
export async function findReadingSection(
  supabase: Supabase,
  courseId: string,
  sectionId: string,
): Promise<ReadingSection | null> {
  const { data, error } = await supabase
    .from("reading_sections")
    .select(SECTION_COLUMNS)
    .eq("course_id", courseId)
    .eq("id", sectionId)
    .maybeSingle();
  if (error) failed("Loading the reading section", error);
  return data && toSection(data);
}
