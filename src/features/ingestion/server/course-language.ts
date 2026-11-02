import "server-only";
import { courseLanguage } from "@/features/ingestion/domain/course-language";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The Course language, which the build writes the Knowledge map in: the
 * one the Student asked for in the Brief, else the most common language of
 * the Materials (`courseLanguage`). Reads on the admin client or a
 * Student's session client.
 */
export async function loadCourseLanguage(
  supabase: Supabase,
  courseId: string,
): Promise<{ name: string; chosen: boolean }> {
  const [course, materials] = await Promise.all([
    supabase
      .from("courses")
      .select("language")
      .eq("id", courseId)
      .maybeSingle(),
    supabase
      .from("materials")
      .select("language")
      .eq("course_id", courseId)
      .order("position"),
  ]);
  if (course.error) failed("Loading the Course's language", course.error);
  if (materials.error) {
    failed("Loading the Materials' languages", materials.error);
  }
  const chosen = course.data?.language ?? null;
  return chosen
    ? { name: chosen, chosen: true }
    : {
        name: courseLanguage(materials.data.map(({ language }) => language)),
        chosen: false,
      };
}
