import "server-only";
import { z } from "zod";
import { getExamFacts } from "@/features/brief/server";
import { getUser } from "@/lib/auth/user";
import { failed } from "@/lib/supabase/failed";
import { createClient } from "@/lib/supabase/server";

/**
 * The Brief's exam date of a Course when the exam is over (before today)
 * and the Student has not answered "How did the exam go?" for that date,
 * otherwise null. A later past date asks again. Null for an unknown or
 * another Student's Course.
 */
export async function getExamToReport(
  courseId: string,
): Promise<string | null> {
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) return null;
  const supabase = await createClient();
  const { examDate } = await getExamFacts(supabase, courseId);
  if (examDate === null || examDate >= new Date().toISOString().slice(0, 10)) {
    return null;
  }
  const { data, error } = await supabase
    .from("exam_results")
    .select("id")
    .eq("course_id", courseId)
    .eq("exam_date", examDate)
    .maybeSingle();
  if (error) failed("Loading the exam result", error);
  return data ? null : examDate;
}
