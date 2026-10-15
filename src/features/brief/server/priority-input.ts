import "server-only";
import type { AdminSupabase } from "@/lib/supabase/types";

/** What the priority workflow reads of a Course's Brief. */
export type BriefForPriorities = {
  /** The Student's free-text statements; null without any. */
  notes: string | null;
  /** When a note was last added; null before the first. */
  notesUpdatedAt: string | null;
  /** The Materials the exam does not cover. */
  excludedMaterialIds: string[];
};

/**
 * A Course's Brief as the priority workflow reads it on the admin client,
 * scoped to the Course; empty without a Brief.
 */
export async function loadBriefForPriorities(
  supabase: AdminSupabase,
  courseId: string,
): Promise<BriefForPriorities> {
  const [brief, excluded] = await Promise.all([
    supabase
      .from("briefs")
      .select("notes, notes_updated_at")
      .eq("course_id", courseId)
      .maybeSingle(),
    supabase
      .from("brief_excluded_materials")
      .select("material_id")
      .eq("course_id", courseId),
  ]);
  if (brief.error) {
    throw new Error(`Loading the Brief failed: ${brief.error.message}`);
  }
  if (excluded.error) {
    throw new Error(
      `Loading the excluded Materials failed: ${excluded.error.message}`,
    );
  }
  return {
    notes: brief.data?.notes ?? null,
    notesUpdatedAt: brief.data?.notes_updated_at ?? null,
    excludedMaterialIds: excluded.data.map((row) => row.material_id),
  };
}
