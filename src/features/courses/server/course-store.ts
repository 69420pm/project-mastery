import "server-only";
import type { Supabase } from "@/lib/supabase/types";
import type { CourseListItem } from "@/features/courses/types";

/**
 * Reads and writes Courses as the signed-in Student, so Row Level Security
 * applies: another Student's Course reads as missing.
 */

function fail(action: string, error: { message: string }): never {
  throw new Error(`${action} failed: ${error.message}`);
}

/** The Student's Courses, most recently updated first. */
export async function listCourses(
  supabase: Supabase,
): Promise<CourseListItem[]> {
  const { data, error } = await supabase
    .from("courses")
    .select("id, name")
    .order("updated_at", { ascending: false });
  if (error) fail("Loading the Courses", error);
  return data;
}

/** Creates a Course owned by the signed-in Student and returns its id. */
export async function insertCourse(
  supabase: Supabase,
  name: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("courses")
    .insert({ name })
    .select("id")
    .single();
  if (error) fail("Creating the Course", error);
  return data.id;
}

/** Renames one of the Student's Courses. False when it is missing or not theirs. */
export async function updateCourseName(
  supabase: Supabase,
  courseId: string,
  name: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("courses")
    .update({ name })
    .eq("id", courseId)
    .select("id");
  if (error) fail("Renaming the Course", error);
  return data.length > 0;
}

/**
 * Deletes one of the Student's Courses. False when it is missing or not
 * theirs.
 */
export async function removeCourse(
  supabase: Supabase,
  courseId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("courses")
    .delete()
    .eq("id", courseId)
    .select("id");
  if (error) fail("Deleting the Course", error);
  return data.length > 0;
}
