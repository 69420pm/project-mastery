import "server-only";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The ids of the Materials a Course's Brief excludes, read on the admin
 * client or a Student's session client; none without a Brief.
 */
export async function loadExcludedMaterialIds(
  supabase: Supabase,
  courseId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("brief_excluded_materials")
    .select("material_id")
    .eq("course_id", courseId);
  if (error) failed("Loading the excluded Materials", error);
  return data.map((row) => row.material_id);
}
