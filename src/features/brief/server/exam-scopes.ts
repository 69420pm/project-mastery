import "server-only";
import type { BriefExamScope } from "@/features/brief/domain/intake";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The Course's exam scopes, read on the admin client or a Student's session
 * client; none without any.
 */
export async function loadExamScopes(
  supabase: Supabase,
  courseId: string,
): Promise<BriefExamScope[]> {
  const { data, error } = await supabase
    .from("exam_scopes")
    .select("topic_id, scope, words")
    .eq("course_id", courseId)
    .order("created_at");
  if (error) failed("Loading the exam scopes", error);
  return data.map((row) => ({
    topicId: row.topic_id,
    scope: row.scope as BriefExamScope["scope"],
    words: row.words,
  }));
}

/**
 * Sets the exam scope of one Topic of the Course, or removes it when
 * `scope` is null, as the signed-in Student (`set_exam_scope`). False when
 * the Brief or the Topic is not theirs.
 */
export async function storeExamScope(
  supabase: Supabase,
  courseId: string,
  {
    topicId,
    scope,
    words,
  }: Pick<BriefExamScope, "topicId"> & {
    scope: BriefExamScope["scope"] | null;
    words: string | null;
  },
): Promise<boolean> {
  const { data, error } = await supabase.rpc("set_exam_scope", {
    course_id: courseId,
    topic_id: topicId,
    ...(scope !== null && { scope }),
    ...(words !== null && { words }),
  });
  if (error) failed("Saving the exam scope", error);
  return data === true;
}
