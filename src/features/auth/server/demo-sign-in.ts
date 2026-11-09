import "server-only";
import { notFound, redirect } from "next/navigation";
import { COURSE_LIST_PATH } from "@/features/courses";
import { getCourseList } from "@/features/courses/server";
import { courseMapPath } from "@/features/knowledge-map/server";
import { getDemoCredentials } from "@/features/auth/server/demo-env";
import { createClient } from "@/lib/supabase/server";

/**
 * The demo link (`GET /demo`): signs the visitor into the shared demo account
 * and opens its most recently updated Course's map, so a visitor sees the app
 * without an account of their own. The credentials stay on the server
 * (`DEMO_EMAIL`, `DEMO_PASSWORD`); without them the link is a 404.
 */
export async function signInDemo(): Promise<never> {
  const credentials = getDemoCredentials();
  if (!credentials) notFound();

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(credentials);
  if (error) redirect("/login?message=unexpected");

  const [course] = await getCourseList();
  redirect(course ? courseMapPath(course.id) : COURSE_LIST_PATH);
}
