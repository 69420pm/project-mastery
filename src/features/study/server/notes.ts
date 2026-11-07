import "server-only";
import type { MaterialNoteEntry } from "@/features/study/types";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The notes of the Course's Materials, in Material order: the notation and
 * conventions each Material's Outline found. Materials without notes are
 * left out.
 */
export async function loadMaterialNotes(
  supabase: Supabase,
  courseId: string,
): Promise<MaterialNoteEntry[]> {
  const { data, error } = await supabase
    .from("materials")
    .select("name, notes")
    .eq("course_id", courseId)
    .not("notes", "is", null)
    .order("position");
  if (error) failed("Loading the Material notes", error);
  return data.flatMap(({ name, notes }) =>
    notes?.trim() ? [{ material: name, text: notes.trim() }] : [],
  );
}
