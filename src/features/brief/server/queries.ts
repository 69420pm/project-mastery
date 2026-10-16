import "server-only";
import { z } from "zod";
import { briefPath } from "@/features/brief/domain/brief-paths";
import { isIntakeDone } from "@/features/brief/domain/intake";
import { loadFields, openBrief } from "@/features/brief/server/brief-store";
import type { BriefWithMessages, ExamFacts } from "@/features/brief/types";
import { getUser, requireUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The signed-in Student's Brief of a Course with its messages, created with
 * its static opening message when the Course has none yet, and with the next
 * open Finding posted once intake is done (`openBrief`). Null when the id
 * is malformed or the Course is unknown or another Student's (show
 * not-found).
 */
export async function getBrief(
  courseId: string,
): Promise<BriefWithMessages | null> {
  await requireUser(briefPath(courseId));
  if (!z.uuid().safeParse(courseId).success) return null;

  const messages = await openBrief(await createClient(), courseId);
  return messages && { courseId, messages };
}

/**
 * The exam date, weekly hours and goal of a Course's Brief, read with
 * `supabase`, a Student's session client; each null when not set or without
 * a Brief.
 */
export async function getExamFacts(
  supabase: Supabase,
  courseId: string,
): Promise<ExamFacts> {
  const { data, error } = await supabase
    .from("briefs")
    .select("exam_date, hours_per_week, goal")
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) throw new Error(`Loading the Brief failed: ${error.message}`);
  return {
    examDate: data?.exam_date ?? null,
    hoursPerWeek:
      data?.hours_per_week == null ? null : Number(data.hours_per_week),
    goal: (data?.goal ?? null) as ExamFacts["goal"],
  };
}

/**
 * Whether the Student has finished telling the AI about the Course's exam
 * (`isIntakeDone`). False without a Brief or a signed-in Student.
 */
export async function getIntakeDone(courseId: string): Promise<boolean> {
  if (!z.uuid().safeParse(courseId).success) return false;
  if (!(await getUser())) return false;
  return isIntakeDone(await loadFields(await createClient(), courseId));
}
