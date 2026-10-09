import "server-only";
import { listCourses } from "@/features/courses/server/course-store";
import type { CourseListItem } from "@/features/courses/types";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in Student's Courses, most recently updated first. Empty when
 * signed out, without redirecting: each page guards itself with
 * `requireUser`.
 */
export async function getCourseList(): Promise<CourseListItem[]> {
  if (!(await getUser())) return [];
  return listCourses(await createClient());
}
